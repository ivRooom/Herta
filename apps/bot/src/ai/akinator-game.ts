import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { toSafeAiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { CommandHandler } from '@herta/plugin-sdk';
import {
  AKINATOR_ANSWERS,
  AKINATOR_MAX_TURNS,
  akinatorAnswerLabel,
  buildAkinatorPrompt,
  isAkinatorAnswer,
  parseAkinatorResponse,
  type AkinatorAnswer,
  type AkinatorTurnRecord,
} from './akinator-game-core.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const PREFIX = 'herta:akinator:v1:';
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

interface AkinatorSession {
  id: string;
  guildId: string;
  userId: string;
  history: AkinatorTurnRecord[];
  excludedGuesses: string[];
  turn: number;
  currentQuestion: string;
  pendingGuess: string | null;
}

const sessions = new Map<string, AkinatorSession>();

export function clearAkinatorGuildSessions(guildId: string): void {
  for (const session of sessions.values()) {
    if (session.guildId === guildId) sessions.delete(session.id);
  }
}

export function createAkinatorCommandHandler(
  definition: CommandHandler<ChatInputCommandInteraction>['definition'],
  getService: () => Promise<AiRuntimeGenerationService | null>,
): CommandHandler<ChatInputCommandInteraction> {
  return {
    definition,
    async execute(interaction) {
      await startAkinatorGame(interaction, getService);
    },
  };
}

async function startAkinatorGame(
  interaction: ChatInputCommandInteraction,
  getService: () => Promise<AiRuntimeGenerationService | null>,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'サーバー内でのみ利用できます。' });
    return;
  }

  const session: AkinatorSession = {
    id: randomUUID().replaceAll('-', ''),
    guildId: interaction.guildId,
    userId: interaction.user.id,
    history: [],
    excludedGuesses: [],
    turn: 0,
    currentQuestion: '',
    pendingGuess: null,
  };

  await interaction.deferReply();

  const service = await getService();
  if (!service) {
    await interaction.editReply({
      content: 'AI機能が現在利用できないため、キャラ当てゲームを開始できません。',
    });
    return;
  }

  const initialTurn = await requestNextTurn(service, session);
  if (!initialTurn.ok) {
    await interaction.editReply({ content: initialTurn.message });
    return;
  }

  sessions.set(session.id, session);
  await interaction.editReply({
    embeds: [buildQuestionEmbed(session)],
    components: [buildAnswerRows(session)],
  });

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: SESSION_TIMEOUT_MS,
  });

  collector.on('collect', (button) => {
    void handleAkinatorButton(button, session, getService).then((completed) => {
      if (completed) collector.stop('completed');
    });
  });

  collector.on('end', (_collected, reason) => {
    if (reason === 'completed' || sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    void interaction
      .editReply({
        content: '⌛ 時間切れのためキャラ当てゲームを終了しました。もう一度実行してください。',
        embeds: [],
        components: [],
      })
      .catch(() => undefined);
  });
}

type NextTurnResult = { ok: true } | { ok: false; message: string };

/**
 * AIへ次のターンを問い合わせ、質問または推測をsessionへ反映する。
 * 呼び出し元のUI更新(reply/update)は行わない。
 */
async function requestNextTurn(
  service: AiRuntimeGenerationService,
  session: AkinatorSession,
): Promise<NextTurnResult> {
  session.turn += 1;
  const prompt = buildAkinatorPrompt({
    history: session.history,
    excludedGuesses: session.excludedGuesses,
    turnNumber: session.turn,
    maxTurns: AKINATOR_MAX_TURNS,
  });

  let text: string;
  try {
    const response = await service.generate({
      feature: 'ai.akinator',
      input: prompt,
      guildId: session.guildId,
      scopeGuildId: session.guildId,
      userId: session.userId,
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
    });
    text = response.text;
  } catch (error) {
    return { ok: false, message: toSafeAiFoundationError(error).userMessage };
  }

  const result = parseAkinatorResponse(text);
  if (!result) {
    return { ok: false, message: 'AIの応答を解釈できませんでした。' };
  }

  if (result.type === 'guess') {
    session.pendingGuess = result.guess;
  } else {
    session.currentQuestion = result.question;
    session.pendingGuess = null;
  }
  return { ok: true };
}

async function handleAkinatorButton(
  interaction: ButtonInteraction,
  session: AkinatorSession,
  getService: () => Promise<AiRuntimeGenerationService | null>,
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.sessionId !== session.id) return false;
  if (sessions.get(session.id) !== session) return false;

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: 'このゲームは開始した本人だけ操作できます。',
      allowedMentions: { parse: [] },
    });
    return false;
  }

  await interaction.deferUpdate();

  if (parsed.kind === 'answer') {
    session.history.push({ question: session.currentQuestion, answer: parsed.answer });
  } else if (parsed.kind === 'guess-correct') {
    sessions.delete(session.id);
    await interaction.editReply({ embeds: [buildWinEmbed(session)], components: [] });
    return true;
  } else {
    if (session.pendingGuess) session.excludedGuesses.push(session.pendingGuess);
    session.pendingGuess = null;
    if (session.turn >= AKINATOR_MAX_TURNS) {
      sessions.delete(session.id);
      await interaction.editReply({ embeds: [buildGiveUpEmbed()], components: [] });
      return true;
    }
  }

  const service = await getService();
  const nextTurn = service
    ? await requestNextTurn(service, session)
    : { ok: false as const, message: 'AI機能が現在利用できません。' };
  if (!nextTurn.ok) {
    sessions.delete(session.id);
    await interaction.editReply({
      content: nextTurn.message,
      embeds: [],
      components: [],
    });
    return true;
  }

  if (session.pendingGuess) {
    await interaction.editReply({
      embeds: [buildGuessEmbed(session)],
      components: [buildGuessRow(session)],
    });
    return false;
  }

  await interaction.editReply({
    embeds: [buildQuestionEmbed(session)],
    components: [buildAnswerRows(session)],
  });
  return false;
}

function buildQuestionEmbed(session: AkinatorSession): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🔮 キャラ当てゲーム (${session.turn}/${AKINATOR_MAX_TURNS})`)
    .setDescription(session.currentQuestion)
    .setColor(0x7c6df2)
    .setFooter({ text: '思い浮かべた実在・架空の人物について、下のボタンで回答してください' });
}

function buildAnswerRows(session: AkinatorSession): ActionRowBuilder<ButtonBuilder> {
  const styles: Record<AkinatorAnswer, ButtonStyle> = {
    yes: ButtonStyle.Success,
    probably: ButtonStyle.Success,
    unknown: ButtonStyle.Secondary,
    probably_not: ButtonStyle.Danger,
    no: ButtonStyle.Danger,
  };
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    AKINATOR_ANSWERS.map((answer) =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${session.id}:ans:${answer}`)
        .setLabel(akinatorAnswerLabel(answer))
        .setStyle(styles[answer]),
    ),
  );
}

function buildGuessEmbed(session: AkinatorSession): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🔮 キャラ当てゲーム — 推測')
    .setDescription(`もしかして……**${session.pendingGuess}** ではないですか？`)
    .setColor(0xf1c40f)
    .setFooter({ text: `${session.turn}/${AKINATOR_MAX_TURNS}ターン目` });
}

function buildGuessRow(session: AkinatorSession): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${session.id}:guess:correct`)
      .setLabel('正解！')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${session.id}:guess:incorrect`)
      .setLabel('違います')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildWinEmbed(session: AkinatorSession): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎉 正解！')
    .setDescription(`**${session.pendingGuess}** を${session.turn}ターンで当てました！`)
    .setColor(0x2ecc71);
}

function buildGiveUpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🤔 ギブアップ…')
    .setDescription(
      `${AKINATOR_MAX_TURNS}ターン以内に当てられませんでした。また挑戦させてください！`,
    )
    .setColor(0x95a5a6);
}

type ParsedCustomId =
  | { sessionId: string; kind: 'answer'; answer: AkinatorAnswer }
  | { sessionId: string; kind: 'guess-correct' }
  | { sessionId: string; kind: 'guess-incorrect' };

function parseCustomId(customId: string): ParsedCustomId | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [sessionId, kind, extra] = customId.slice(PREFIX.length).split(':');
  if (!sessionId) return null;
  if (kind === 'ans' && extra && isAkinatorAnswer(extra)) {
    return { sessionId, kind: 'answer', answer: extra };
  }
  if (kind === 'guess' && extra === 'correct') return { sessionId, kind: 'guess-correct' };
  if (kind === 'guess' && extra === 'incorrect') return { sessionId, kind: 'guess-incorrect' };
  return null;
}
