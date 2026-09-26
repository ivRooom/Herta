import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
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
import { MBTI_TYPE_KEYS, mbtiManifest, mbtiRoleConfigKey } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler } from '@herta/plugin-sdk';
import {
  MBTI_AXES,
  MBTI_LIKERT_ANSWERS,
  MBTI_TYPES,
  computeMbtiAxisPercent,
  computeMbtiType,
  createEmptyMbtiScores,
  isMbtiLikertAnswer,
  mbtiLikertLabel,
  mbtiLikertWeight,
  selectMbtiQuestions,
  type MbtiQuestion,
  type MbtiScores,
} from './mbti-core.js';
import { renderMbtiQuestionCard } from './mbti-card.js';
import { reconcileMbtiRole } from './mbti-roles.js';

const PREFIX = 'herta:mbti:v1:';
// 50問を5段階で回答するため、以前の12問2択より長時間を要する。1問あたりidleで
// タイムアウトをリセットしつつ、全体には上限(absolute time)を設ける。
const QUESTION_IDLE_MS = 3 * 60 * 1000;
const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000;

export interface MbtiPluginConfig {
  enabled: boolean;
  /** MBTIタイプ(例: 'INTJ')ごとに付与するRole ID。未設定タイプはnull。 */
  mbtiRoles: Record<string, string | null>;
}

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

function nullableDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMbtiRoleMap(source: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(
    MBTI_TYPE_KEYS.map((type) => [type, nullableDiscordId(source[mbtiRoleConfigKey(type)])]),
  );
}

export function normalizeMbtiConfig(value: unknown): MbtiPluginConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    mbtiRoles: readMbtiRoleMap(source),
  };
}

export const mbtiPlugin = definePlugin<MbtiPluginConfig, unknown, PrismaClient>({
  manifest: mbtiManifest,
  async onDisable(context) {
    clearMbtiGuildSessions(context.guildId);
  },
  provideCommands(context) {
    return [
      createMbtiCommandHandler(mbtiManifest.commands[0]!, {
        logger: context.logger,
        prisma: context.prisma,
        getRoleMap: () => normalizeMbtiConfig(context.config).mbtiRoles,
        isEnabled: () => normalizeMbtiConfig(context.config).enabled,
      }),
    ];
  },
});

export interface MbtiCommandOptions {
  logger: Logger;
  prisma: PrismaClient;
  getRoleMap: () => Record<string, string | null>;
  isEnabled: () => boolean;
}

interface MbtiSession {
  id: string;
  guildId: string;
  userId: string;
  /** 人ごとにselectMbtiQuestions()で抽出・シャッフルした、この診断で出題する設問一覧。 */
  questions: MbtiQuestion[];
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
  if (!options.isEnabled()) {
    await interaction.reply({
      content: 'MBTI Pluginは現在無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session: MbtiSession = {
    id: randomUUID().replaceAll('-', ''),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    questions: selectMbtiQuestions(),
    questionIndex: 0,
    scores: createEmptyMbtiScores(),
    answers: [],
  };
  sessions.set(session.id, session);

  await interaction.reply({
    ...(await buildQuestionPayload(session)),
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
        files: [],
        attachments: [],
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

  if (!options.isEnabled()) {
    sessions.delete(session.id);
    await interaction.update({
      content: 'MBTI Pluginが無効になったため診断を終了しました。',
      embeds: [],
      components: [],
      files: [],
      attachments: [],
    });
    return true;
  }

  const question = session.questions[session.questionIndex];
  if (!question) return false;

  session.scores[question.axis] += mbtiLikertWeight(parsed.answer);
  session.answers.push({
    // question.idは出題プール内の固定IDで、人によって選ばれる設問・順序が変わっても
    // 集計側(question_index列)で同一設問だと判別できるようにする。
    questionIndex: question.id,
    axis: question.axis,
    answer: parsed.answer,
  });
  session.questionIndex += 1;

  if (session.questionIndex >= session.questions.length) {
    const type = computeMbtiType(session.scores);
    sessions.delete(session.id);

    void recordMbtiStats(options.prisma, options.logger, session, type);
    const roleNote = await tryAssignMbtiRole(interaction, type, options);
    await interaction.update({
      content: null,
      embeds: [buildResultEmbed(type, session.scores, roleNote)],
      components: [],
      files: [],
      attachments: [],
    });
    return true;
  }

  try {
    await interaction.update({
      ...(await buildQuestionPayload(session)),
      components: [buildAnswerRow(session)],
    });
  } catch (error) {
    options.logger.warn(
      { err: error, guildId: session.guildId, userId: session.userId },
      'MBTI質問カードの生成・送信に失敗しました',
    );
    sessions.delete(session.id);
    await interaction
      .update({
        content: '⚠️ 質問の表示に失敗しました。もう一度 `/mbti` を実行してください。',
        embeds: [],
        components: [],
        files: [],
        attachments: [],
      })
      .catch(() => undefined);
    return true;
  }
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

async function buildQuestionPayload(
  session: MbtiSession,
): Promise<{ content: string; files: AttachmentBuilder[]; attachments: []; embeds: [] }> {
  const question = session.questions[session.questionIndex]!;
  const png = await renderMbtiQuestionCard({
    questionIndex: session.questionIndex,
    totalQuestions: session.questions.length,
    prompt: question.prompt,
    axis: question.axis,
  });
  const attachment = new AttachmentBuilder(png, {
    name: `mbti-${session.id}-${session.questionIndex}.png`,
  }).setDescription(question.prompt);
  return {
    content: '当てはまる度合いに近いボタンを選んでください（簡易診断です）',
    files: [attachment],
    attachments: [],
    embeds: [],
  };
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
