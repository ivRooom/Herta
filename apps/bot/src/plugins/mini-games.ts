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
  type User,
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
import { isBlackjackHandComplete, settleBlackjackPvp } from './mini-games-blackjack-pvp.js';
import { publishMiniGameCompletion } from './mini-games-completion-events.js';
import { createMiniGamesV3CommandHandlers } from './mini-games-v3.js';

const CUSTOM_ID_PREFIX = 'herta:mini-games:v1:';
const COIN_FLIP_ANIMATION_MS = 1_100;

export interface MiniGamesConfig {
  enabled: boolean;
  statsEnabled: boolean;
  coinflipAnimation: boolean;
  sessionTimeoutSeconds: number;
  highLowMaxRounds: number;
  blackjackDealerHitsSoft17: boolean;
  blackjackAnimation: boolean;
  blackjackAnimationDelayMs: number;
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

interface BlackjackDealerSession extends GameSessionBase {
  type: 'blackjack';
  mode: 'dealer';
  deck: PlayingCard[];
  player: PlayingCard[];
  dealer: PlayingCard[];
  dealerHitsSoft17: boolean;
}

interface BlackjackPvpPlayer {
  userId: string;
  cards: PlayingCard[];
  stood: boolean;
}

interface BlackjackPvpSession extends GameSessionBase {
  type: 'blackjack';
  mode: 'pvp';
  deck: PlayingCard[];
  players: [BlackjackPvpPlayer, BlackjackPvpPlayer];
  activePlayerIndex: 0 | 1;
}

type BlackjackSession = BlackjackDealerSession | BlackjackPvpSession;
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
    return [coinflip, highlow, blackjack, gamestats, ...createMiniGamesV3CommandHandlers(context)];
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
    blackjackAnimation:
      source.blackjackAnimation === undefined ? true : source.blackjackAnimation === true,
    blackjackAnimationDelayMs: clamp(toInteger(source.blackjackAnimationDelayMs, 450), 250, 1_500),
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

  const member1 = interaction.options.getUser('member1');
  const member2 = interaction.options.getUser('member2');
  if (member1 || member2) {
    await executeBlackjackPvp(context, interaction, config, member1, member2);
    return;
  }
  await executeBlackjackDealer(context, interaction, config);
}

async function executeBlackjackDealer(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
  config: MiniGamesConfig,
): Promise<void> {
  const deck = createShuffledDeck();
  const player = [drawCard(deck), drawCard(deck)];
  const dealer = [drawCard(deck), drawCard(deck)];
  const id = createSessionId();
  const session: BlackjackDealerSession = {
    id,
    type: 'blackjack',
    mode: 'dealer',
    guildId: interaction.guildId!,
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
  const openingFinished = openingPlayer.blackjack || openingDealer.blackjack;
  if (!openingFinished) gameSessions.set(id, session);

  if (config.blackjackAnimation) {
    await interaction.reply({
      content: '🃏 **Blackjack**\n🔀 カードをシャッフルしています…',
      allowedMentions: { parse: [] },
    });
    await delay(config.blackjackAnimationDelayMs);
    await interaction.editReply({ content: renderBlackjackDealStage(session) });
    await delay(config.blackjackAnimationDelayMs);
    await interaction.editReply({
      content: openingFinished ? renderBlackjackFinal(session) : renderBlackjack(session, false),
      components: openingFinished ? [] : [buildBlackjackRow(session.id)],
    });
  } else {
    await interaction.reply({
      content: openingFinished ? renderBlackjackFinal(session) : renderBlackjack(session, false),
      components: openingFinished ? [] : [buildBlackjackRow(session.id)],
      allowedMentions: { parse: [] },
    });
  }

  if (!openingFinished) armSessionTimeout(session, config.sessionTimeoutSeconds);
  await recordMetricsSafely(
    context,
    [
      ['minigame_plays', 1],
      ['blackjack_plays', 1],
    ],
    interaction.user.id,
  );
  if (openingFinished) await recordBlackjackSettlement(context, session);
  await publishMiniGameCompletion(interaction);
}

async function executeBlackjackPvp(
  context: MiniGamesRuntimeContext,
  interaction: ChatInputCommandInteraction,
  config: MiniGamesConfig,
  member1: User | null,
  member2: User | null,
): Promise<void> {
  const first = member2 ? (member1 ?? interaction.user) : interaction.user;
  const second = member2 ?? member1;
  if (!second) {
    await replyEphemeral(interaction, '対戦するメンバーを指定してください。');
    return;
  }
  if (first.id === second.id) {
    await replyEphemeral(interaction, '同じメンバー同士では対戦できません。');
    return;
  }
  if (first.bot || second.bot) {
    await replyEphemeral(interaction, 'BotはBlackjack PvPへ参加できません。');
    return;
  }

  const deck = createShuffledDeck();
  const id = createSessionId();
  const session: BlackjackPvpSession = {
    id,
    type: 'blackjack',
    mode: 'pvp',
    guildId: interaction.guildId!,
    userId: interaction.user.id,
    deck,
    players: [
      { userId: first.id, cards: [drawCard(deck), drawCard(deck)], stood: false },
      { userId: second.id, cards: [drawCard(deck), drawCard(deck)], stood: false },
    ],
    activePlayerIndex: 0,
    expiresAt: 0,
    processing: false,
    async expireMessage() {
      await interaction
        .editReply({
          content: `${renderBlackjackPvp(session)}\n\n⌛ **時間切れで対戦終了**`,
          components: [],
        })
        .catch(() => undefined);
    },
  };

  const openingFinished = session.players.some((player) => blackjackScore(player.cards).blackjack);
  if (!openingFinished) gameSessions.set(id, session);

  if (config.blackjackAnimation) {
    await interaction.reply({
      content: `🃏 **Blackjack PvP**\n<@${first.id}> vs <@${second.id}>\n🔀 カードをシャッフルしています…`,
      allowedMentions: { parse: [] },
    });
    await delay(config.blackjackAnimationDelayMs);
    await interaction.editReply({ content: renderBlackjackPvpDealStage(session) });
    await delay(config.blackjackAnimationDelayMs);
    await interaction.editReply({
      content: openingFinished ? renderBlackjackPvpFinal(session) : renderBlackjackPvp(session),
      components: openingFinished ? [] : [buildBlackjackRow(session.id)],
    });
  } else {
    await interaction.reply({
      content: openingFinished ? renderBlackjackPvpFinal(session) : renderBlackjackPvp(session),
      components: openingFinished ? [] : [buildBlackjackRow(session.id)],
      allowedMentions: { parse: [] },
    });
  }

  if (!openingFinished) armSessionTimeout(session, config.sessionTimeoutSeconds);
  for (const player of session.players) {
    await recordMetricsSafely(
      context,
      [
        ['minigame_plays', 1],
        ['blackjack_plays', 1],
      ],
      player.userId,
    );
  }
  if (openingFinished) await recordBlackjackPvpSettlement(context, session);
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
  if (
    interaction.guildId !== session.guildId ||
    !canOperateGameSession(session, interaction.user.id)
  ) {
    await replyEphemeral(
      interaction,
      session.type === 'blackjack' && session.mode === 'pvp'
        ? 'このBlackjack対戦は参加メンバーだけ操作できます。'
        : 'このゲームは開始した本人だけ操作できます。',
    );
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
  if (session.mode === 'pvp') {
    await handleBlackjackPvpButton(context, session, action, config, interaction);
    return;
  }

  session.dealerHitsSoft17 = config.blackjackDealerHitsSoft17;
  if (action === 'hit') {
    const animated = config.blackjackAnimation;
    if (animated) {
      await interaction.update({
        content: `${renderBlackjack(session, false)}\n\n🃏 カードを引いています…`,
        components: [],
      });
      await delay(config.blackjackAnimationDelayMs);
    }
    session.player.push(drawCard(session.deck));
    const score = blackjackScore(session.player);
    if (score.bust || score.total === 21) {
      if (!score.bust) playDealer(session);
      endSession(session);
      await finishButtonMessage(interaction, animated, renderBlackjackFinal(session), []);
      await recordBlackjackSettlement(context, session);
      await publishMiniGameCompletion(interaction);
      return;
    }
    armSessionTimeout(session, config.sessionTimeoutSeconds);
    await finishButtonMessage(interaction, animated, renderBlackjack(session, false), [
      buildBlackjackRow(session.id),
    ]);
    return;
  }
  if (action === 'stand') {
    const animated = config.blackjackAnimation;
    if (animated) {
      await interaction.update({
        content: `${renderBlackjack(session, false)}\n\n🎩 Dealerのターン…`,
        components: [],
      });
      await delay(config.blackjackAnimationDelayMs);
    }
    playDealer(session);
    endSession(session);
    await finishButtonMessage(interaction, animated, renderBlackjackFinal(session), []);
    await recordBlackjackSettlement(context, session);
    await publishMiniGameCompletion(interaction);
    return;
  }
  await replyEphemeral(interaction, '不明なBlackjack操作です。');
}

async function handleBlackjackPvpButton(
  context: MiniGamesRuntimeContext,
  session: BlackjackPvpSession,
  action: string,
  config: MiniGamesConfig,
  interaction: ButtonInteraction,
): Promise<void> {
  const playerIndex = session.players.findIndex((player) => player.userId === interaction.user.id);
  if (playerIndex < 0) {
    await replyEphemeral(interaction, 'このBlackjack対戦の参加者ではありません。');
    return;
  }
  if (playerIndex !== session.activePlayerIndex) {
    await replyEphemeral(interaction, '現在は相手のターンです。');
    return;
  }
  if (action !== 'hit' && action !== 'stand') {
    await replyEphemeral(interaction, '不明なBlackjack操作です。');
    return;
  }

  const player = session.players[playerIndex]!;
  const animated = config.blackjackAnimation;
  if (animated) {
    await interaction.update({
      content: `${renderBlackjackPvp(session)}\n\n${action === 'hit' ? '🃏 カードを引いています…' : '✋ Standを選択しました…'}`,
      components: [],
    });
    await delay(config.blackjackAnimationDelayMs);
  }

  if (action === 'hit') player.cards.push(drawCard(session.deck));
  if (action === 'stand') player.stood = true;
  const score = blackjackScore(player.cards);
  if (score.bust) {
    endSession(session);
    await finishButtonMessage(interaction, animated, renderBlackjackPvpFinal(session), []);
    await recordBlackjackPvpSettlement(context, session);
    await publishMiniGameCompletion(interaction);
    return;
  }
  if (score.total >= 21) player.stood = true;

  if (isBlackjackHandComplete(player.cards, player.stood)) {
    const otherIndex: 0 | 1 = playerIndex === 0 ? 1 : 0;
    const other = session.players[otherIndex];
    if (isBlackjackHandComplete(other.cards, other.stood)) {
      endSession(session);
      await finishButtonMessage(interaction, animated, renderBlackjackPvpFinal(session), []);
      await recordBlackjackPvpSettlement(context, session);
      await publishMiniGameCompletion(interaction);
      return;
    }
    session.activePlayerIndex = otherIndex;
  }

  armSessionTimeout(session, config.sessionTimeoutSeconds);
  await finishButtonMessage(interaction, animated, renderBlackjackPvp(session), [
    buildBlackjackRow(session.id),
  ]);
}

async function finishButtonMessage(
  interaction: ButtonInteraction,
  alreadyAcknowledged: boolean,
  content: string,
  components: ActionRowBuilder<ButtonBuilder>[],
): Promise<void> {
  if (alreadyAcknowledged) {
    await interaction.editReply({ content, components });
  } else {
    await interaction.update({ content, components });
  }
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
  session: BlackjackDealerSession,
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

function playDealer(session: BlackjackDealerSession): void {
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

function renderBlackjack(session: BlackjackDealerSession, revealDealer: boolean): string {
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

function renderBlackjackFinal(session: BlackjackDealerSession): string {
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

function renderBlackjackDealStage(session: BlackjackDealerSession): string {
  return [
    '🃏 **Blackjack — Dealing**',
    `Dealer: ${formatPlayingCard(session.dealer[0]!)} 🂠`,
    `あなた: ${formatPlayingCard(session.player[0]!)} 🂠`,
    '',
    'カードを配っています…',
  ].join('\n');
}

function renderBlackjackPvpDealStage(session: BlackjackPvpSession): string {
  const [first, second] = session.players;
  return [
    '🃏 **Blackjack PvP — Dealing**',
    `<@${first.userId}>: ${formatPlayingCard(first.cards[0]!)} 🂠`,
    `<@${second.userId}>: ${formatPlayingCard(second.cards[0]!)} 🂠`,
    '',
    'カードを配っています…',
  ].join('\n');
}

function renderBlackjackPvp(session: BlackjackPvpSession): string {
  const lines = session.players.map((player, index) => {
    const score = blackjackScore(player.cards);
    const turn = index === session.activePlayerIndex ? ' ◀ **TURN**' : '';
    const state = score.bust ? ' · BUST' : player.stood ? ' · STAND' : '';
    return `<@${player.userId}>: ${formatCards(player.cards)} **（${score.total}）**${state}${turn}`;
  });
  return ['🃏 **Blackjack PvP**', ...lines, '', '自分のターンでHit / Standを選んでください。'].join(
    '\n',
  );
}

function renderBlackjackPvpFinal(session: BlackjackPvpSession): string {
  const [first, second] = session.players;
  const outcome = settleBlackjackPvp(first.cards, second.cards);
  const firstScore = blackjackScore(first.cards);
  const secondScore = blackjackScore(second.cards);
  const result =
    outcome === 'player1-win'
      ? `🏆 <@${first.userId}> **WIN!**`
      : outcome === 'player2-win'
        ? `🏆 <@${second.userId}> **WIN!**`
        : '🤝 **PUSH — 引き分け**';
  return [
    '🃏 **Blackjack PvP — Result**',
    `<@${first.userId}>: ${formatCards(first.cards)} **（${firstScore.total}）**`,
    `<@${second.userId}>: ${formatCards(second.cards)} **（${secondScore.total}）**`,
    '',
    result,
  ].join('\n');
}

async function recordBlackjackPvpSettlement(
  context: MiniGamesRuntimeContext,
  session: BlackjackPvpSession,
): Promise<void> {
  const outcome = settleBlackjackPvp(session.players[0].cards, session.players[1].cards);
  if (outcome === 'push') return;
  const winner = session.players[outcome === 'player1-win' ? 0 : 1];
  await recordMetricsSafely(
    context,
    [
      ['minigame_wins', 1],
      ['blackjack_wins', 1],
    ],
    winner.userId,
  );
}

function canOperateGameSession(session: GameSession, userId: string): boolean {
  if (session.type === 'blackjack' && session.mode === 'pvp') {
    return session.players.some((player) => player.userId === userId);
  }
  return session.userId === userId;
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
