import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { recordMbtiQuizCompletion, type MbtiQuizAnswerInput } from '@herta/db';
import type { Logger } from '@herta/logger';
import type { CommandHandler } from '@herta/plugin-sdk';
import {
  MBTI_AXES,
  MBTI_LIKERT_ANSWERS,
  MBTI_QUESTIONS,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  mbtiLikertWeight,
  type MbtiScores,
} from './mini-games-mbti-core.js';
import { reconcileMbtiRole } from './mini-games-mbti-roles.js';

const PREFIX = 'herta:mbti:v1:';
// 50問を5段階で回答するため、以前の12問2択より長時間を要する。1問あたりidleで
// タイムアウトをリセットしつつ、全体には上限(absolute time)を設ける。
const QUESTION_IDLE_MS = 3 * 60 * 1000;
const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000;

export interface MbtiCommandOptions {
  logger: Logger;
  prisma: PrismaClient;
  getRoleMap: () => Record<string, string | null>;
}

interface MbtiSession {
  id: string;
  guildId: string;
  userId: string;
  questionIndex: number;
  scores: MbtiScores;
  answers: MbtiQuizAnswerInput[];
}

const sessions = new Map<string, MbtiSession>();

export function clearMbtiGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) sessions.delete(session.id);
  }
}

export function createMbtiCommandHandler(
  definition: CommandHandler<ChatInputCommandInteraction>['definition'],
  options: MbtiCommandOptions,
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startMbtiQuiz(interaction, options);
    },
  };
}

async function startMbtiQuiz(
  interaction: ChatInputCommandInteraction,
  options: MbtiCommandOptions,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'サーバー内でのみ利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session: MbtiSession = {
    id: randomUUID().replaceAll('-', ''),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    questionIndex: 0,
    scores: createEmptyMbtiScores(),
    answers: [],
  };
  sessions.set(session.id, session);

  await interaction.reply({
    embeds: [buildQuestionEmbed(session)],
    components: [buildAnswerRow(session)],
    flags: MessageFlags.Ephemeral,
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: QUESTION_IDLE_MS,
    time: SESSION_ABSOLUTE_TIMEOUT_MS,
  });

  collector.on('collect', (button) => {
    void handleMbtiButton(button, session, options).then((completed) => {
      if (completed) collector.stop('completed');
    });
  });

  collector.on('end', (_collected, reason) => {
    if (reason === 'completed' || sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    void interaction
      .editReply({
        content: '⌛ 時間切れのため診断を終了しました。もう一度 `/mbti` を実行してください。',
        embeds: [],
        components: [],
      })
      .catch(() => undefined);
  });
}

async function handleMbtiButton(
  interaction: ButtonInteraction,
  session: MbtiSession,
  options: MbtiCommandOptions,
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.sessionId !== session.id) return false;

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: 'この診断は開始した本人だけ操作できます。',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (sessions.get(session.id) !== session) return false;

  const question = MBTI_QUESTIONS[session.questionIndex];
  if (!question) return false;

  session.scores[question.axis] += mbtiLikertWeight(parsed.answer);
  session.answers.push({
    questionIndex: session.questionIndex,
    axis: question.axis,
    answer: parsed.answer,
  });
  session.questionIndex += 1;

  if (session.questionIndex >= MBTI_QUESTIONS.length) {
    const type = computeMbtiType(session.scores);
    sessions.delete(session.id);

    await recordMbtiStats(options.prisma, options.logger, session, type);
    const roleNote = await tryAssignMbtiRole(interaction, type, options);
    await interaction.update({
      embeds: [buildResultEmbed(type, session.scores, roleNote)],
      components: [],
    });
    return true;
  }

  await interaction.update({
    embeds: [buildQuestionEmbed(session)],
    components: [buildAnswerRow(session)],
  });
  return false;
}

/**
 * 診断結果と全回答を匿名集計テーブルへ記録する（LLMの学習・分析用途）。
 * Discordユーザーへの応答をブロックしないよう、失敗はwarnログのみで握りつぶす。
 */
async function recordMbtiStats(
  prisma: PrismaClient,
  logger: Logger,
  session: MbtiSession,
  type: string,
): Promise<void> {
  try {
    await recordMbtiQuizCompletion(prisma, {
      guildId: session.guildId,
      resultType: type,
      eiScore: session.scores.EI,
      snScore: session.scores.SN,
      tfScore: session.scores.TF,
      jpScore: session.scores.JP,
      answers: session.answers,
    });
  } catch (error) {
    logger.warn({ err: error, guildId: session.guildId, type }, 'MBTI統計の記録に失敗しました');
  }
}

async function tryAssignMbtiRole(
  interaction: ButtonInteraction,
  type: string,
  options: MbtiCommandOptions,
): Promise<string | null> {
  const member = interaction.member;
  if (!member || !isGuildMember(member)) return null;

  const roleMap = options.getRoleMap();
  if (Object.values(roleMap).every((roleId) => !roleId)) return null;

  try {
    const result = await reconcileMbtiRole({
      member,
      roleMap,
      resultType: type,
      logger: options.logger,
    });
    if (result.addedRoleId) return `<@&${result.addedRoleId}> を付与しました`;
    return null;
  } catch (error) {
    options.logger.warn(
      { err: error, guildId: interaction.guildId, userId: interaction.user.id, type },
      'MBTI Roleの同期に失敗しました',
    );
    return null;
  }
}

/**
 * ButtonInteraction.memberはGuildMember(client cache済み)か、rolesがstring[]の
 * 生APIオブジェクト(APIInteractionGuildMember)のいずれかになりうる。後者は
 * `.roles.cache`を持たないため、typeof roles === 'object'だけでは判定できない
 * (配列もtypeof 'object'を返す)。cacheの有無で厳密に判定する。
 */
function isGuildMember(member: unknown): member is GuildMember {
  if (!member || typeof member !== 'object') return false;
  const roles = (member as { roles?: unknown }).roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return false;
  return 'cache' in roles;
}

function buildQuestionEmbed(session: MbtiSession): EmbedBuilder {
  const question = MBTI_QUESTIONS[session.questionIndex]!;
  return new EmbedBuilder()
    .setTitle(`🧭 MBTI風性格診断 (${session.questionIndex + 1}/${MBTI_QUESTIONS.length})`)
    .setDescription(question.prompt)
    .setColor(0x7c6df2)
    .setFooter({ text: '当てはまる度合いに近いボタンを選んでください（簡易診断です）' });
}

function buildAnswerRow(session: MbtiSession): ActionRowBuilder<ButtonBuilder> {
  const styles: Record<(typeof MBTI_LIKERT_ANSWERS)[number], ButtonStyle> = {
    agree: ButtonStyle.Success,
    slightly_agree: ButtonStyle.Success,
    neutral: ButtonStyle.Secondary,
    slightly_disagree: ButtonStyle.Danger,
    disagree: ButtonStyle.Danger,
  };
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    MBTI_LIKERT_ANSWERS.map((answer) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${session.id}:${answer}`)
        .setLabel(mbtiLikertLabel(answer))
        .setStyle(styles[answer]),
    ),
  );
}

function buildResultEmbed(type: string, scores: MbtiScores, roleNote: string | null): EmbedBuilder {
  const info = MBTI_TYPES[type];
  const axisLabels: Record<(typeof MBTI_AXES)[number], [string, string]> = {
    EI: ['E', 'I'],
    SN: ['S', 'N'],
    TF: ['T', 'F'],
    JP: ['J', 'P'],
  };
  const breakdown = MBTI_AXES.map((axis) => {
    const [positive, negative] = axisLabels[axis];
    const percent = computeMbtiAxisPercent(scores, axis);
    return `${positive} ${percent}% / ${negative} ${100 - percent}%`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🎉 診断結果: ${type}${info ? ` — ${info.title}` : ''}`)
    .setDescription(info?.description ?? '診断結果を計算できませんでした。')
    .addFields({ name: '各軸の傾向', value: breakdown })
    .setColor(0x2ecc71)
    .setFooter({ text: '簡易診断のため参考程度にご覧ください' });

  if (roleNote) embed.addFields({ name: 'Role', value: roleNote });
  return embed;
}

function parseCustomId(
  customId: string,
): { sessionId: string; answer: (typeof MBTI_LIKERT_ANSWERS)[number] } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, answer] = customId.slice(PREFIX.length).split(':');
  if (!sessionId || !answer || !isMbtiLikertAnswer(answer)) return null;
  return { sessionId, answer };
}
