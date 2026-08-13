import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { miniGamesManifest } from '@herta/plugin-catalog';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import { createCoinFlipGif } from './mini-games-coinflip-animation.js';
import {
  blackjackScore,
  createShuffledDeck,
  drawCard,
  flipCoin,
  formatCards,
  formatPlayingCard,
  resolveHighLow,
  settleBlackjack,
  shouldDealerHit,
  type CoinFace,
  type HighLowChoice,
  type PlayingCard,
} from './mini-games-core.js';
import {
  getMiniGameStats,
  incrementMiniGameMetrics,
  recordMiniGameMaximum,
  type MiniGameMetric,
} from './mini-games-repository.js';
import { formatMiniGameStats } from './mini-games-stats.js';
import { blackjackSettlementMetrics } from './mini-games-blackjack-metrics.js';
import { publishMiniGameCompletion } from './mini-games-completion-events.js';

const CUSTOM_ID_PREFIX = 'herta:mini-games:v1:';
const COIN_FLIP_ANIMATION_MS = 1_100;

export interface MiniGamesConfig {
  enabled: boolean;
  statsEnabled: boolean;
  coinflipAnimation: boolean;
  sessionTimeoutSeconds: number;
  highLowMaxRounds: number;
  blackjackDealerHitsSoft17: boolean;
}

type MiniGamesRuntimeContext = PluginRuntimeContext<MiniGamesConfig, unknown, PrismaClient>;
type GameType = 'highlow' | 'blackjack';

interface GameSessionBase {
  id: string;
  type: GameType;
  guildId: string;
  userId: string;
  expiresAt: number;
  processing: boolean;
  timer?: NodeJS.Timeout;
  expireMessage(): Promise<void>;
}

interface HighLowSession extends GameSessionBase {
  type: 'highlow';
  deck: PlayingCard[];
  current: PlayingCard;
  streak: number;
  maxRounds: number;
}

interface BlackjackSession extends GameSessionBase {
  type: 'blackjack';
  deck: PlayingCard[];
  player: PlayingCard[];
  dealer: PlayingCard[];
  dealerHitsSoft17: boolean;
}

type GameSession = HighLowSession | BlackjackSession;

const gameSessions = new Map<string, GameSession>();

export const miniGamesPlugin = definePlugin<MiniGamesConfig, unknown, PrismaClient>({
  manifest: miniGamesManifest,
  async onDisable(context) {
    clearGuildGameSessions(context.guildId);
  },
  provideCommands(context) {
    const coinflip: CommandHandler<ChatInputCommandInteraction> = {
      definition: miniGamesManifest.commands[0]!,
      async execute(interaction) {
        await executeCoinFlip(context, interaction);
      },
    };
    const highlow: CommandHandler<ChatInputCommandInteraction> = {
      definition: miniGamesManifest.commands[1]!,
      async execute(interaction) {
        await executeHighLow(context, interaction);
      },
    };
    const blackjack: CommandHandler<ChatInputCommandInteraction> = {
      definition: miniGamesManifest.commands[2]!,
      async execute(interaction) {
        await executeBlackjack(context, interaction);
      },
    };
    const gamestats: CommandHandler<ChatInputCommandInteraction> = {
      definition: miniGamesManifest.commands[3]!,
      async execute(interaction) {
        await executeGameStats(context, interaction);
      },
    };
    return [coinflip, highlow, blackjack, gamestats];
  },
  provideEvents() {
    return [
      {
        event: 'interactionCreate',
        async handler(context, ...args) {
          const interaction = args[0] as Interaction | undefined;
          if (!interaction?.isButton()) return;
          await handleGameButton(context as MiniGamesRuntimeContext, interaction);
        },
      },
    ] as PluginEventHandler<MiniGamesConfig>[];
  },
});

export function normalizeMiniGamesConfig(value: unknown): MiniGamesConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    statsEnabled: source.statsEnabled === undefined ? true : source.statsEnabled === true,
    coinflipAnimation:
      source.coinflipAnimation === undefined ? true : source.coinflipAnimation === true,
    sessionTimeoutSeconds: clamp(toInteger(source.sessionTimeoutSeconds, 90), 30, 300),
    highLowMaxRounds: clamp(toInteger(source.highLowMaxRounds, 10), 3, 25),
    blackjackDealerHitsSoft17: source.blackjackDealerHitsSoft17 === true,
  };
}

export function formatCoinFlipResult(result: CoinFace, choice: CoinFace | null = null): string {
  const resultLabel = result === 'heads' ? '表 / Heads' : '裏 / Tails';
  const lines = ['🪙 **Coin Flip**', `結果: **${resultLabel}**`];
  if (choice) {
    const choiceLabel = choice === 'heads' ? '表 / Heads' : '裏 / Tails';
    lines.push(`予想: **${choiceLabel}**`, choice === result ? '🎉 **的中！**' : '💥 **はずれ！**');
  }
  return lines.join('\n');
}

export function parseMiniGameCustomId(
  customId: string,
): { type: GameType; sessionId: string; action: string } | null {
  if (!customId.startsWith(CUSTOM_ID_PREFIX)) return null;
  const parts = customId.slice(CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [type, sessionId, action] = parts;
  if ((type !== 'highlow' && type !== 'blackjack') || !sessionId || !action) return null;
  if (!/^[0-9a-f]{32}$/i.test(sessionId)) return null;
  return { type, sessionId, action };
}

async function executeCoinFlip(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }
  const requested = interaction.options.getString('choice');
  const choice: CoinFace | null = requested === 'heads' || requested === 'tails' ? requested : null;
  const result = flipCoin();
  const metrics: Array<readonly [MiniGameMetric, number]> = [
    ['minigame_plays', 1],
    ['coinflip_plays', 1],
    ...(choice ? ([['coinflip_predictions', 1]] as const) : []),
    ...(choice === result
      ? ([
          ['coinflip_wins', 1],
          ['minigame_wins', 1],
        ] as const)
      : []),
  ];

  if (!config.coinflipAnimation) {
    await interaction.reply({
      content: formatCoinFlipResult(result, choice),
      allowedMentions: { parse: [] },
    });
    await recordMetricsSafely(context, metrics, interaction.user.id);
    await publishMiniGameCompletion(interaction);
    return;
  }

  const animation = new AttachmentBuilder(createCoinFlipGif(), { name: 'herta-coinflip.gif' });
  await interaction.reply({
    content: '🪙 **Coin Flip**\nコインを投げています…',
    files: [animation],
    allowedMentions: { parse: [] },
  });
  await delay(COIN_FLIP_ANIMATION_MS);
  await interaction.editReply({ content: formatCoinFlipResult(result, choice) });
  await recordMetricsSafely(context, metrics, interaction.user.id);
  await publishMiniGameCompletion(interaction);
}

async function executeHighLow(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }

  const deck = createShuffledDeck();
  const id = createSessionId();
  const session: HighLowSession = {
    id,
    type: 'highlow',
    guildId: interaction.guildId,
    userId: interaction.user.id,
    deck,
    current: drawCard(deck),
    streak: 0,
    maxRounds: config.highLowMaxRounds,
    expiresAt: 0,
    processing: false,
    async expireMessage() {
      await interaction
        .editReply({
          content: `${renderHighLow(session)}\n\n⌛ **時間切れでゲーム終了**`,
          components: [],
        })
        .catch(() => undefined);
    },
  };
  gameSessions.set(id, session);
  armSessionTimeout(session, config.sessionTimeoutSeconds);
  await interaction.reply({
    content: renderHighLow(session),
    components: [buildHighLowRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['highlow_plays', 1],
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);
}

async function executeBlackjack(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }

  const deck = createShuffledDeck();
  const player = [drawCard(deck), drawCard(deck)];
  const dealer = [drawCard(deck), drawCard(deck)];
  const id = createSessionId();
  const session: BlackjackSession = {
    id,
    type: 'blackjack',
    guildId: interaction.guildId,
    userId: interaction.user.id,
    deck,
    player,
    dealer,
    dealerHitsSoft17: config.blackjackDealerHitsSoft17,
    expiresAt: 0,
    processing: false,
    async expireMessage() {
      await interaction
        .editReply({
          content: `${renderBlackjack(session, false)}\n\n⌛ **時間切れでゲーム終了**`,
          components: [],
        })
        .catch(() => undefined);
    },
  };

  const openingPlayer = blackjackScore(player);
  const openingDealer = blackjackScore(dealer);
  if (openingPlayer.blackjack || openingDealer.blackjack) {
    await interaction.reply({
      content: renderBlackjackFinal(session),
      allowedMentions: { parse: [] },
    });
    await recordMetricsSafely(
      context,
      [
        ['minigame_plays', 1],
        ['blackjack_plays', 1],
      ],
      interaction.user.id,
    );
    await recordBlackjackSettlement(context, session);
    await publishMiniGameCompletion(interaction);
    return;
  }

  gameSessions.set(id, session);
  armSessionTimeout(session, config.sessionTimeoutSeconds);
  await interaction.reply({
    content: renderBlackjack(session, false),
    components: [buildBlackjackRow(session.id)],
    allowedMentions: { parse: [] },
  });
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['blackjack_plays', 1],
    ],
    interaction.user.id,
  );
  await publishMiniGameCompletion(interaction);
}

async function handleGameButton(
  context: MiniGamesRuntimeContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseMiniGameCustomId(interaction.customId);
  if (!parsed) return;
  const session = gameSessions.get(parsed.sessionId);
  if (!session || session.type !== parsed.type || Date.now() >= session.expiresAt) {
    if (session) endSession(session);
    await replyEphemeral(
      interaction,
      'このゲームセッションは終了しています。もう一度コマンドを実行してください。',
    );
    return;
  }
  if (interaction.guildId !== session.guildId || interaction.user.id !== session.userId) {
    await replyEphemeral(interaction, 'このゲームは開始した本人だけ操作できます。');
    return;
  }
  if (session.processing) {
    await replyEphemeral(interaction, '前の操作を処理中です。');
    return;
  }

  session.processing = true;
  try {
    const config = normalizeMiniGamesConfig(context.config);
    if (!config.enabled) {
      endSession(session);
      await interaction.update({
        content: 'Mini Games Pluginが無効になったためゲームを終了しました。',
        components: [],
      });
      return;
    }
    if (session.type === 'highlow') {
      await handleHighLowButton(context, session, parsed.action, config, interaction);
    } else {
      await handleBlackjackButton(context, session, parsed.action, config, interaction);
    }
  } finally {
    if (gameSessions.get(session.id) === session) session.processing = false;
  }
}

async function handleHighLowButton(
  context: MiniGamesRuntimeContext,
  session: HighLowSession,
  action: string,
  config: MiniGamesConfig,
  interaction: ButtonInteraction,
): Promise<void> {
  if (action === 'stop') {
    endSession(session);
    await interaction.update({
      content: `${renderHighLow(session)}\n\n🏁 **ゲーム終了 — ${session.streak}連勝**`,
      components: [],
    });
    return;
  }
  if (action !== 'higher' && action !== 'lower') {
    await replyEphemeral(interaction, '不明なHigh-Low操作です。');
    return;
  }

  const previous = session.current;
  const next = drawCard(session.deck);
  const choice = action as HighLowChoice;
  const result = resolveHighLow(previous, next, choice);
  session.current = next;

  if (result === 'wrong') {
    endSession(session);
    await interaction.update({
      content: [
        '🎴 **High-Low**',
        `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
        `❌ ${choice === 'higher' ? 'HIGH' : 'LOW'} は不正解！`,
        `最終スコア: **${session.streak}連勝**`,
      ].join('\n'),
      components: [],
    });
    return;
  }

  if (result === 'tie') {
    armSessionTimeout(session, config.sessionTimeoutSeconds);
    await interaction.update({
      content: [
        '🎴 **High-Low**',
        `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
        '➖ 同じランクなのでノーカウント！',
        '',
        renderHighLow(session),
      ].join('\n'),
      components: [buildHighLowRow(session.id)],
    });
    return;
  }

  session.streak += 1;
  if (session.streak >= session.maxRounds) {
    endSession(session);
    await interaction.update({
      content: [
        '🎴 **High-Low**',
        `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
        '✅ 正解！',
        `🏆 **${session.streak}連勝でパーフェクトクリア！**`,
      ].join('\n'),
      components: [],
    });
    await recordMetricsSafely(
      context,
      [
        ['highlow_round_wins', 1],
        ['highlow_clears', 1],
        ['minigame_wins', 1],
      ],
      session.userId,
    );
    await recordMaximumSafely(context, session.guildId, session.userId, session.streak);
    await publishMiniGameCompletion(interaction);
    return;
  }

  armSessionTimeout(session, config.sessionTimeoutSeconds);
  await interaction.update({
    content: [
      '🎴 **High-Low**',
      `前: **${formatPlayingCard(previous)}** → 次: **${formatPlayingCard(next)}**`,
      `✅ 正解！ **${session.streak}連勝**`,
      '',
      renderHighLow(session),
    ].join('\n'),
    components: [buildHighLowRow(session.id)],
  });
  await recordMetricsSafely(context, [['highlow_round_wins', 1]], session.userId);
  await recordMaximumSafely(context, session.guildId, session.userId, session.streak);
  await publishMiniGameCompletion(interaction);
}

async function handleBlackjackButton(
  context: MiniGamesRuntimeContext,
  session: BlackjackSession,
  action: string,
  config: MiniGamesConfig,
  interaction: ButtonInteraction,
): Promise<void> {
  session.dealerHitsSoft17 = config.blackjackDealerHitsSoft17;
  if (action === 'hit') {
    session.player.push(drawCard(session.deck));
    const score = blackjackScore(session.player);
    if (score.bust) {
      endSession(session);
      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      await recordBlackjackSettlement(context, session);
      await publishMiniGameCompletion(interaction);
      return;
    }
    if (score.total === 21) {
      playDealer(session);
      endSession(session);
      await interaction.update({ content: renderBlackjackFinal(session), components: [] });
      await recordBlackjackSettlement(context, session);
      await publishMiniGameCompletion(interaction);
      return;
    }
    armSessionTimeout(session, config.sessionTimeoutSeconds);
    await interaction.update({
      content: renderBlackjack(session, false),
      components: [buildBlackjackRow(session.id)],
    });
    return;
  }
  if (action === 'stand') {
    playDealer(session);
    endSession(session);
    await interaction.update({ content: renderBlackjackFinal(session), components: [] });
    await recordBlackjackSettlement(context, session);
    await publishMiniGameCompletion(interaction);
    return;
  }
  await replyEphemeral(interaction, '不明なBlackjack操作です。');
}

async function executeGameStats(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyEphemeral(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeMiniGamesConfig(context.config);
  if (!config.enabled) {
    await replyEphemeral(interaction, 'Mini Games Pluginは現在無効です。');
    return;
  }
  if (!config.statsEnabled) {
    await replyEphemeral(interaction, 'Mini Gamesの戦績記録は現在無効です。');
    return;
  }
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  await interaction.deferReply();
  const stats = await getMiniGameStats(context.prisma, interaction.guildId, userId);
  await interaction.editReply({
    content: formatMiniGameStats(userId, stats),
    allowedMentions: { parse: [] },
  });
}

async function recordBlackjackSettlement(
  context: MiniGamesRuntimeContext,
  session: BlackjackSession,
): Promise<void> {
  await recordMetricsSafely(
    context,
    blackjackSettlementMetrics(session.player, session.dealer),
    session.userId,
  );
}

async function recordMetricsSafely(
  context: MiniGamesRuntimeContext,
  metrics: readonly (readonly [MiniGameMetric, number])[],
  userId: string,
): Promise<void> {
  if (!normalizeMiniGamesConfig(context.config).statsEnabled || metrics.length === 0) return;
  try {
    await incrementMiniGameMetrics(context.prisma, context.guildId, userId, metrics);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: context.guildId, userId },
      'Mini Games戦績の保存に失敗しました',
    );
  }
}

async function recordMaximumSafely(
  context: MiniGamesRuntimeContext,
  guildId: string,
  userId: string,
  streak: number,
): Promise<void> {
  if (!normalizeMiniGamesConfig(context.config).statsEnabled) return;
  try {
    await recordMiniGameMaximum(context.prisma, guildId, userId, 'highlow_best_streak', streak);
  } catch (error) {
    context.logger.warn({ err: error, guildId, userId }, 'High-Low最高連勝の保存に失敗しました');
  }
}

function playDealer(session: BlackjackSession): void {
  while (shouldDealerHit(session.dealer, session.dealerHitsSoft17)) {
    session.dealer.push(drawCard(session.deck));
  }
}

function renderHighLow(session: HighLowSession): string {
  return [
    '🎴 **High-Low**',
    `現在のカード: **${formatPlayingCard(session.current)}**`,
    `連勝: **${session.streak} / ${session.maxRounds}**`,
    '次のカードは高い？低い？（Aは最強、同値はノーカウント）',
  ].join('\n');
}

function renderBlackjack(session: BlackjackSession, revealDealer: boolean): string {
  const playerScore = blackjackScore(session.player);
  const dealerScore = blackjackScore(session.dealer);
  const dealerCards = revealDealer
    ? formatCards(session.dealer)
    : `${formatPlayingCard(session.dealer[0]!)} 🂠`;
  const dealerLabel = revealDealer ? `（${dealerScore.total}）` : '';
  return [
    '🃏 **Blackjack**',
    `Dealer: ${dealerCards} ${dealerLabel}`.trim(),
    `あなた: ${formatCards(session.player)} **（${playerScore.total}）**`,
    '',
    '21を超えないようにHit / Standを選んでください。',
  ].join('\n');
}

function renderBlackjackFinal(session: BlackjackSession): string {
  const outcome = settleBlackjack(session.player, session.dealer);
  const playerScore = blackjackScore(session.player);
  const dealerScore = blackjackScore(session.dealer);
  const result =
    outcome === 'player-blackjack'
      ? '✨ **BLACKJACK！あなたの勝ち！**'
      : outcome === 'dealer-blackjack'
        ? '🫥 **Dealer Blackjack — 負け**'
        : outcome === 'player-win'
          ? dealerScore.bust
            ? '🎉 **Dealer Bust — あなたの勝ち！**'
            : '🎉 **あなたの勝ち！**'
          : outcome === 'dealer-win'
            ? playerScore.bust
              ? '💥 **Bust — 負け**'
              : '😵 **Dealerの勝ち**'
            : '🤝 **Push — 引き分け**';
  return [
    '🃏 **Blackjack — Result**',
    `Dealer: ${formatCards(session.dealer)} **（${dealerScore.total}）**`,
    `あなた: ${formatCards(session.player)} **（${playerScore.total}）**`,
    '',
    result,
  ].join('\n');
}

function buildHighLowRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}highlow:${sessionId}:higher`)
      .setLabel('⬆️ HIGH')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}highlow:${sessionId}:lower`)
      .setLabel('⬇️ LOW')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}highlow:${sessionId}:stop`)
      .setLabel('やめる')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildBlackjackRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}blackjack:${sessionId}:hit`)
      .setLabel('Hit')
      .setEmoji('🃏')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}blackjack:${sessionId}:stand`)
      .setLabel('Stand')
      .setEmoji('✋')
      .setStyle(ButtonStyle.Success),
  );
}

function armSessionTimeout(session: GameSession, seconds: number): void {
  if (session.timer) clearTimeout(session.timer);
  const timeoutMs = seconds * 1_000;
  session.expiresAt = Date.now() + timeoutMs;
  session.timer = setTimeout(() => {
    if (gameSessions.get(session.id) !== session) return;
    gameSessions.delete(session.id);
    void session.expireMessage();
  }, timeoutMs);
  session.timer.unref?.();
}

function endSession(session: GameSession): void {
  if (session.timer) clearTimeout(session.timer);
  gameSessions.delete(session.id);
}

function clearGuildGameSessions(guildId: string): void {
  for (const session of gameSessions.values()) {
    if (session.guildId === guildId) endSession(session);
  }
}

function createSessionId(): string {
  return randomUUID().replaceAll('-', '');
}

async function replyEphemeral(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

function toInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
