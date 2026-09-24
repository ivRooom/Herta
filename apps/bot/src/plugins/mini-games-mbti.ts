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
} from 'discord.js';
import type { CommandHandler } from '@herta/plugin-sdk';
import {
  MBTI_QUESTIONS,
  MBTI_TYPES,
  computeMbtiType,
  createEmptyMbtiScores,
  type MbtiScores,
} from './mini-games-mbti-core.js';

const PREFIX = 'herta:mbti:v1:';
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

interface MbtiSession {
  id: string;
  guildId: string;
  userId: string;
  questionIndex: number;
  scores: MbtiScores;
}

const sessions = new Map<string, MbtiSession>();

export function clearMbtiGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) sessions.delete(session.id);
  }
}

export function createMbtiCommandHandler(
  definition: CommandHandler<ChatInputCommandInteraction>['definition'],
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startMbtiQuiz(interaction);
    },
  };
}

async function startMbtiQuiz(interaction: ChatInputCommandInteraction): Promise<void> {
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
  };
  sessions.set(session.id, session);

  await interaction.reply({
    embeds: [buildQuestionEmbed(session)],
    components: [buildQuestionRow(session)],
    flags: MessageFlags.Ephemeral,
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: SESSION_TIMEOUT_MS,
  });

  collector.on('collect', (button) => {
    void handleMbtiButton(button, session).then((completed) => {
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

  session.scores[question.axis] += parsed.direction;
  session.questionIndex += 1;

  if (session.questionIndex >= MBTI_QUESTIONS.length) {
    const type = computeMbtiType(session.scores);
    sessions.delete(session.id);
    await interaction.update({
      embeds: [buildResultEmbed(type)],
      components: [],
    });
    return true;
  }

  await interaction.update({
    embeds: [buildQuestionEmbed(session)],
    components: [buildQuestionRow(session)],
  });
  return false;
}

function buildQuestionEmbed(session: MbtiSession): EmbedBuilder {
  const question = MBTI_QUESTIONS[session.questionIndex]!;
  return new EmbedBuilder()
    .setTitle(`🧭 MBTI風性格診断 (${session.questionIndex + 1}/${MBTI_QUESTIONS.length})`)
    .setDescription(question.prompt)
    .setColor(0x7c6df2)
    .setFooter({ text: '当てはまる方のボタンを選んでください（簡易診断です）' });
}

function buildQuestionRow(session: MbtiSession): ActionRowBuilder<ButtonBuilder> {
  const question = MBTI_QUESTIONS[session.questionIndex]!;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${session.id}:pos`)
      .setLabel(question.optionPositive)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${session.id}:neg`)
      .setLabel(question.optionNegative)
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildResultEmbed(type: string): EmbedBuilder {
  const info = MBTI_TYPES[type];
  return new EmbedBuilder()
    .setTitle(`🎉 診断結果: ${type}${info ? ` — ${info.title}` : ''}`)
    .setDescription(info?.description ?? '診断結果を計算できませんでした。')
    .setColor(0x2ecc71)
    .setFooter({ text: '簡易診断のため参考程度にご覧ください' });
}

function parseCustomId(customId: string): { sessionId: string; direction: 1 | -1 } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, direction] = customId.slice(PREFIX.length).split(':');
  if (!sessionId || (direction !== 'pos' && direction !== 'neg')) return null;
  return { sessionId, direction: direction === 'pos' ? 1 : -1 };
}
