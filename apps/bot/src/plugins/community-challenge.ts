import type { PrismaClient } from '@herta/db';
import { communityChallengeManifest } from '@herta/plugin-catalog';
import {
  COMMUNITY_CHALLENGES,
  COMMUNITY_CHALLENGE_BY_ID,
  communityChallengeDifficultyLabel,
  communityChallengeMetricLabel,
  communitySeasonLevelProgress,
  formatCommunityChallengeValue,
  getCommunityChallengeWindow,
  getCommunitySeasonWindow,
  selectCommunityChallenges,
  type CommunityChallengeDefinition,
  type CommunityChallengePeriod,
  type CommunityChallengeWindow,
} from '@herta/shared';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  ensureCommunityChallengeAssignment,
  getCommunityChallengeMetrics,
  getCommunityDailyClearStreak,
  getCommunitySeasonSummary,
  listCommunityChallengeCompletions,
  listCommunitySeasonLeaderboard,
  syncCommunityChallengeCompletions,
  type CommunityChallengeCompletionRecord,
  type CommunityChallengeMetricValues,
  type CommunitySeasonLeaderboardRecord,
  type CommunitySeasonSummary,
  type NewlyCompletedChallenge,
} from './community-challenge-repository.js';
import {
  subscribeMiniGameCompletion,
  unsubscribeMiniGameCompletion,
} from './mini-games-completion-events.js';

const EPHEMERAL_FLAG = 64;
const DISCORD_ID_PATTERN = /^\d+$/;
const AUTO_SYNC_CACHE_LIMIT = 20_000;
const autoSyncLastAt = new Map<string, number>();

export interface CommunityChallengeConfig {
  enabled: boolean;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  dailyChallengeCount: number;
  weeklyChallengeCount: number;
  includeMinecraftChallenges: boolean;
  includeMiniGameChallenges: boolean;
  autoSync: boolean;
  autoSyncCooldownSeconds: number;
  notifyCompletions: boolean;
  completionChannelId: string | null;
  mentionOnCompletion: boolean;
  seasonPointMultiplier: number;
  seasonLevelPoints: number;
  leaderboardSize: number;
  ephemeralSync: boolean;
}

interface CommunityChallengeInteraction {
  guildId: string | null;
  user: { id: string };
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string): number | null;
    getUser(name: string): { id: string } | null;
  };
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: []; users?: string[] };
}

interface ChallengeChannel {
  isTextBased(): boolean;
  send(options: ReplyOptions): Promise<unknown>;
}

interface ChallengeGuild {
  id: string;
  channels: { fetch(channelId: string): Promise<ChallengeChannel | null> };
}

interface ChallengeMessage {
  guildId: string | null;
  author: { id: string; bot?: boolean };
  guild: ChallengeGuild | null;
  reply(options: ReplyOptions): Promise<unknown>;
}

interface ChallengeReaction {
  message: ChallengeMessage;
}

interface ChallengeReactionUser {
  id: string;
  bot?: boolean;
}

interface ChallengeVoiceMember {
  user: { bot?: boolean };
}

interface ChallengeVoiceState {
  id: string;
  channelId: string | null;
  selfMute?: boolean | null;
  serverMute?: boolean | null;
  selfDeaf?: boolean | null;
  serverDeaf?: boolean | null;
  member?: ChallengeVoiceMember | null;
  guild: ChallengeGuild;
}

interface MiniGameChallengeInteraction {
  guildId: string | null;
  user: { id: string; bot?: boolean };
  guild: ChallengeGuild | null;
  commandName?: string;
  customId?: string;
  isChatInputCommand(): boolean;
  isButton(): boolean;
}

interface CompletionNotificationTarget {
  guild: ChallengeGuild | null;
  reply?: (options: ReplyOptions) => Promise<unknown>;
}

interface ChallengePeriodState {
  period: CommunityChallengePeriod;
  window: CommunityChallengeWindow;
  definitions: CommunityChallengeDefinition[];
  metrics: CommunityChallengeMetricValues;
  completions: CommunityChallengeCompletionRecord[];
  newlyCompleted: NewlyCompletedChallenge[];
}

type CommunityChallengeContext = PluginRuntimeContext<
  CommunityChallengeConfig,
  unknown,
  PrismaClient
>;

export const communityChallengePlugin = definePlugin<
  CommunityChallengeConfig,
  unknown,
  PrismaClient
>({
  manifest: communityChallengeManifest,
  async onEnable(context) {
    subscribeMiniGameCompletion(`community-challenge:${context.guildId}`, async (event) => {
      if (event.guildId !== context.guildId) return;
      await maybeAutoSync(
        context,
        event.guildId,
        event.userId,
        {
          guild: event.guild as unknown as ChallengeGuild,
          reply: (options) => event.reply(options),
        },
        true,
      );
    });
  },
  provideCommands(context) {
    const challenge: CommandHandler<CommunityChallengeInteraction> = {
      definition: communityChallengeManifest.commands[0]!,
      async execute(interaction) {
        await executeChallengeCommand(context, interaction);
      },
    };
    const season: CommandHandler<CommunityChallengeInteraction> = {
      definition: communityChallengeManifest.commands[1]!,
      async execute(interaction) {
        await executeSeasonCommand(context, interaction);
      },
    };
    return [challenge, season];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleChallengeMessage(
            context as CommunityChallengeContext,
            args[0] as ChallengeMessage | undefined,
          );
        },
      },
      {
        event: 'messageReactionAdd',
        async handler(context, ...args) {
          await handleChallengeReaction(
            context as CommunityChallengeContext,
            args[0] as ChallengeReaction | undefined,
            args[1] as ChallengeReactionUser | undefined,
          );
        },
      },
      {
        event: 'voiceStateUpdate',
        async handler(context, ...args) {
          await handleChallengeVoice(
            context as CommunityChallengeContext,
            args[0] as ChallengeVoiceState | undefined,
            args[1] as ChallengeVoiceState | undefined,
          );
        },
      },
    ] as PluginEventHandler<CommunityChallengeConfig>[];
  },
  async onDisable(context) {
    unsubscribeMiniGameCompletion(`community-challenge:${context.guildId}`);
    clearAutoSyncGuild(context.guildId);
  },
});

export function normalizeCommunityChallengeConfig(value: unknown): CommunityChallengeConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    dailyEnabled: source.dailyEnabled === undefined ? true : source.dailyEnabled === true,
    weeklyEnabled: source.weeklyEnabled === undefined ? true : source.weeklyEnabled === true,
    dailyChallengeCount: clamp(toInteger(source.dailyChallengeCount, 3), 1, 5),
    weeklyChallengeCount: clamp(toInteger(source.weeklyChallengeCount, 3), 1, 5),
    includeMinecraftChallenges:
      source.includeMinecraftChallenges === undefined
        ? true
        : source.includeMinecraftChallenges === true,
    includeMiniGameChallenges: source.includeMiniGameChallenges === true,
    autoSync: source.autoSync === undefined ? true : source.autoSync === true,
    autoSyncCooldownSeconds: clamp(toInteger(source.autoSyncCooldownSeconds, 30), 10, 600),
    notifyCompletions:
      source.notifyCompletions === undefined ? true : source.notifyCompletions === true,
    completionChannelId: nullableDiscordId(source.completionChannelId),
    mentionOnCompletion: source.mentionOnCompletion === true,
    seasonPointMultiplier: clamp(toInteger(source.seasonPointMultiplier, 1), 1, 3),
    seasonLevelPoints: clamp(toInteger(source.seasonLevelPoints, 100), 25, 500),
    leaderboardSize: clamp(toInteger(source.leaderboardSize, 10), 5, 25),
    ephemeralSync: source.ephemeralSync === undefined ? true : source.ephemeralSync === true,
  };
}

async function executeChallengeCommand(
  context: CommunityChallengeContext,
  interaction: CommunityChallengeInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return replyPrivate(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeCommunityChallengeConfig(context.config);
  if (!config.enabled)
    return replyPrivate(interaction, 'Community Challenge Pluginは現在無効です。');
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'today') {
    if (!config.dailyEnabled) return replyPrivate(interaction, 'Daily Challengeは現在無効です。');
    const state = await loadPeriodState(
      context,
      interaction.guildId,
      interaction.user.id,
      'daily',
      config,
      true,
    );
    await interaction.reply({
      content: formatChallengePeriod(state, config),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'week') {
    if (!config.weeklyEnabled) return replyPrivate(interaction, 'Weekly Challengeは現在無効です。');
    const state = await loadPeriodState(
      context,
      interaction.guildId,
      interaction.user.id,
      'weekly',
      config,
      true,
    );
    await interaction.reply({
      content: formatChallengePeriod(state, config),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'sync') {
    const states = await syncEnabledPeriods(
      context,
      interaction.guildId,
      interaction.user.id,
      config,
    );
    const newlyCompleted = states.flatMap((state) => state.newlyCompleted);
    const season = getCommunitySeasonWindow();
    const summary = await getCommunitySeasonSummary(
      context.prisma,
      interaction.guildId,
      interaction.user.id,
      season.key,
    );
    const streak = await getCommunityDailyClearStreak(
      context.prisma,
      interaction.guildId,
      interaction.user.id,
      getCommunityChallengeWindow('daily').key,
    );
    await interaction.reply({
      content: formatSyncResult(newlyCompleted, summary, streak, config),
      flags: config.ephemeralSync ? EPHEMERAL_FLAG : undefined,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'catalog') {
    const period = readPeriod(interaction.options.getString('period'));
    const pages = formatChallengeCatalog(period, config);
    await interaction.reply({ content: pages[0]!, allowedMentions: { parse: [] } });
    for (const page of pages.slice(1)) {
      await interaction.followUp({ content: page, allowedMentions: { parse: [] } });
    }
    return;
  }

  await replyPrivate(interaction, '不明なChallenge操作です。');
}

async function executeSeasonCommand(
  context: CommunityChallengeContext,
  interaction: CommunityChallengeInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return replyPrivate(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeCommunityChallengeConfig(context.config);
  if (!config.enabled)
    return replyPrivate(interaction, 'Community Challenge Pluginは現在無効です。');
  const subcommand = interaction.options.getSubcommand();
  const season = getCommunitySeasonWindow();

  if (subcommand === 'status') {
    const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
    if (config.dailyEnabled) {
      await ensurePeriodDefinitions(context, interaction.guildId, 'daily', config);
    }
    const [summary, streak] = await Promise.all([
      getCommunitySeasonSummary(context.prisma, interaction.guildId, userId, season.key),
      getCommunityDailyClearStreak(
        context.prisma,
        interaction.guildId,
        userId,
        getCommunityChallengeWindow('daily').key,
      ),
    ]);
    await interaction.reply({
      content: formatSeasonStatus(userId, summary, streak, config),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'leaderboard') {
    const limit = clamp(interaction.options.getInteger('limit') ?? config.leaderboardSize, 5, 25);
    const records = await listCommunitySeasonLeaderboard(
      context.prisma,
      interaction.guildId,
      season.key,
      limit,
    );
    await interaction.reply({
      content: formatSeasonLeaderboard(records, config),
      allowedMentions: { parse: [] },
    });
    return;
  }

  await replyPrivate(interaction, '不明なSeason操作です。');
}

async function loadPeriodState(
  context: CommunityChallengeContext,
  guildId: string,
  userId: string,
  period: CommunityChallengePeriod,
  config: CommunityChallengeConfig,
  sync: boolean,
  now = new Date(),
): Promise<ChallengePeriodState> {
  const { window, definitions } = await ensurePeriodDefinitions(
    context,
    guildId,
    period,
    config,
    now,
  );
  const metrics = await getCommunityChallengeMetrics(
    context.prisma,
    guildId,
    userId,
    window.startDateKey,
    window.endDateKey,
  );
  const season = getCommunitySeasonWindow(now);
  const newlyCompleted = sync
    ? await syncCommunityChallengeCompletions(context.prisma, {
        guildId,
        userId,
        periodType: period,
        periodKey: window.key,
        seasonKey: season.key,
        definitions,
        metrics,
        pointMultiplier: config.seasonPointMultiplier,
      })
    : [];
  const completions = await listCommunityChallengeCompletions(
    context.prisma,
    guildId,
    userId,
    period,
    window.key,
  );
  return { period, window, definitions, metrics, completions, newlyCompleted };
}

async function ensurePeriodDefinitions(
  context: CommunityChallengeContext,
  guildId: string,
  period: CommunityChallengePeriod,
  config: CommunityChallengeConfig,
  now = new Date(),
): Promise<{ window: CommunityChallengeWindow; definitions: CommunityChallengeDefinition[] }> {
  const window = getCommunityChallengeWindow(period, now);
  const count = period === 'daily' ? config.dailyChallengeCount : config.weeklyChallengeCount;
  const selected = selectCommunityChallenges({
    guildId,
    period,
    periodKey: window.key,
    count,
    includeMinecraft: config.includeMinecraftChallenges,
    includeMiniGames: config.includeMiniGameChallenges,
  });
  const assignment = await ensureCommunityChallengeAssignment(
    context.prisma,
    guildId,
    period,
    window.key,
    selected.map((definition) => definition.id),
  );
  const definitions = assignment.challengeIds.flatMap((id) => {
    const definition = COMMUNITY_CHALLENGE_BY_ID.get(id);
    return definition ? [definition] : [];
  });
  return { window, definitions };
}

async function syncEnabledPeriods(
  context: CommunityChallengeContext,
  guildId: string,
  userId: string,
  config: CommunityChallengeConfig,
): Promise<ChallengePeriodState[]> {
  const states: ChallengePeriodState[] = [];
  if (config.dailyEnabled) {
    states.push(await loadPeriodState(context, guildId, userId, 'daily', config, true));
  }
  if (config.weeklyEnabled) {
    states.push(await loadPeriodState(context, guildId, userId, 'weekly', config, true));
  }
  return states;
}

export function formatChallengePeriod(
  state: ChallengePeriodState,
  config: CommunityChallengeConfig,
): string {
  const completedIds = new Set(state.completions.map((record) => record.challengeId));
  const title = state.period === 'daily' ? '☀️ Daily Challenges' : '🗓️ Weekly Challenges';
  const lines = [`**${title} · ${state.window.key}**`];
  for (const definition of state.definitions) {
    const current = Math.min(state.metrics[definition.metric], definition.target);
    const completed = completedIds.has(definition.id);
    const points = definition.basePoints * config.seasonPointMultiplier;
    lines.push(
      '',
      `${completed ? '✅' : '▫️'} ${definition.emoji} **${definition.name}** · ${communityChallengeDifficultyLabel(definition.difficulty)} · **+${points}pt**`,
      `${progressBar(current, definition.target)} ${formatCommunityChallengeValue(definition.metric, current)}/${formatCommunityChallengeValue(definition.metric, definition.target)} · ${communityChallengeMetricLabel(definition.metric)}`,
    );
  }
  const completedCount = state.definitions.filter((definition) =>
    completedIds.has(definition.id),
  ).length;
  lines.push(
    '',
    `**Clear ${completedCount}/${state.definitions.length}**${completedCount === state.definitions.length ? ' · 🌟 ALL CLEAR!' : ''}`,
    `更新まで <t:${Math.floor(state.window.endsAt.getTime() / 1000)}:R>`,
  );
  return lines.join('\n').slice(0, 1990);
}

export function formatSeasonStatus(
  userId: string,
  summary: CommunitySeasonSummary,
  streak: number,
  config: CommunityChallengeConfig,
  now = new Date(),
): string {
  const season = getCommunitySeasonWindow(now);
  const level = communitySeasonLevelProgress(summary.points, config.seasonLevelPoints);
  const rank = summary.rank === null ? '未ランク' : `#${summary.rank.toLocaleString()}`;
  return [
    `**🏆 <@${userId}> Community Season ${season.index}**`,
    `期間 **${season.startDateKey} → ${previousDateKey(season.endDateKey)}**`,
    '',
    `Season Level **${level.level}** · **${summary.points.toLocaleString()}pt**`,
    `${progressBar(level.current, level.needed)} ${level.current.toLocaleString()}/${level.needed.toLocaleString()}pt (${level.percentage}%)`,
    `Season Rank **${rank}**${summary.participants > 0 ? ` / ${summary.participants.toLocaleString()}人` : ''}`,
    `Challenge Clear **${summary.completionCount.toLocaleString()}**`,
    `🔥 Daily ALL CLEAR Streak **${streak.toLocaleString()}日**`,
    '',
    `Season終了まで <t:${Math.floor(season.endsAt.getTime() / 1000)}:R>`,
  ].join('\n');
}

export function formatSeasonLeaderboard(
  records: readonly CommunitySeasonLeaderboardRecord[],
  config: CommunityChallengeConfig,
): string {
  const season = getCommunitySeasonWindow();
  if (records.length === 0) {
    return `**🏆 Community Season ${season.index} Leaderboard**\nまだChallenge完了データがありません。`;
  }
  const lines = records.map((record, index) => {
    const level = communitySeasonLevelProgress(record.points, config.seasonLevelPoints).level;
    return `${index + 1}. <@${record.userId}> — **${record.points.toLocaleString()}pt** · Lv.${level} · ${record.completionCount} clears`;
  });
  return [`**🏆 Community Season ${season.index} Leaderboard**`, ...lines]
    .join('\n')
    .slice(0, 1990);
}

export function formatChallengeCatalog(
  period: CommunityChallengePeriod | undefined,
  config: CommunityChallengeConfig,
): string[] {
  const definitions = COMMUNITY_CHALLENGES.filter(
    (definition) =>
      (!period || definition.period === period) &&
      (config.includeMinecraftChallenges || definition.metric !== 'minecraft_seconds') &&
      (config.includeMiniGameChallenges ||
        (definition.metric !== 'minigame_plays' &&
          definition.metric !== 'minigame_wins' &&
          definition.metric !== 'highlow_round_wins' &&
          definition.metric !== 'blackjack_wins')),
  );
  const lines = definitions.map(
    (definition) =>
      `${definition.emoji} **${definition.name}** · ${definition.period === 'daily' ? 'Daily' : 'Weekly'} / ${communityChallengeDifficultyLabel(definition.difficulty)} · ${formatCommunityChallengeValue(definition.metric, definition.target)} ${communityChallengeMetricLabel(definition.metric)} · **+${definition.basePoints * config.seasonPointMultiplier}pt**`,
  );
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += 10) {
    pages.push(
      [
        pages.length === 0
          ? '**📚 Community Challenge Catalog**'
          : '**📚 Challenge Catalog · continued**',
        ...lines.slice(index, index + 10),
      ]
        .join('\n')
        .slice(0, 1990),
    );
  }
  return pages.length > 0
    ? pages
    : ['**📚 Community Challenge Catalog**\n表示できるChallengeがありません。'];
}

function formatSyncResult(
  newlyCompleted: readonly NewlyCompletedChallenge[],
  summary: CommunitySeasonSummary,
  streak: number,
  config: CommunityChallengeConfig,
): string {
  const level = communitySeasonLevelProgress(summary.points, config.seasonLevelPoints).level;
  if (newlyCompleted.length === 0) {
    return [
      '✅ Challengeを同期しました。新しいClearはありません。',
      `Season **${summary.points.toLocaleString()}pt** · Lv.${level}`,
      `🔥 Daily Streak **${streak}日**`,
    ].join('\n');
  }
  return [
    `🎯 **${newlyCompleted.length}個のChallengeをClear！**`,
    ...newlyCompleted.map(
      ({ definition, points }) => `• ${definition.emoji} **${definition.name}** · +${points}pt`,
    ),
    '',
    `Season **${summary.points.toLocaleString()}pt** · Lv.${level}`,
    `🔥 Daily Streak **${streak}日**`,
  ].join('\n');
}

async function handleChallengeMessage(
  context: CommunityChallengeContext,
  message: ChallengeMessage | undefined,
): Promise<void> {
  if (!message?.guildId || message.author.bot) return;
  await maybeAutoSync(context, message.guildId, message.author.id, {
    guild: message.guild,
    reply: (options) => message.reply(options),
  });
}

async function handleChallengeReaction(
  context: CommunityChallengeContext,
  reaction: ChallengeReaction | undefined,
  user: ChallengeReactionUser | undefined,
): Promise<void> {
  const message = reaction?.message;
  if (!message?.guildId || !user || user.bot) return;
  const target: CompletionNotificationTarget = {
    guild: message.guild,
    reply: (options) => message.reply(options),
  };
  await maybeAutoSync(context, message.guildId, user.id, target);
  if (!message.author.bot && message.author.id !== user.id) {
    await maybeAutoSync(context, message.guildId, message.author.id, target);
  }
}

async function handleChallengeVoice(
  context: CommunityChallengeContext,
  oldState: ChallengeVoiceState | undefined,
  newState: ChallengeVoiceState | undefined,
): Promise<void> {
  if (!oldState || !newState || oldState.member?.user.bot || newState.member?.user.bot) return;
  if (!voiceActivityMayHaveClosed(oldState, newState)) return;
  await maybeAutoSync(context, newState.guild.id, newState.id, { guild: newState.guild }, true);
}

export function isMiniGameChallengeInteraction(
  interaction: MiniGameChallengeInteraction | undefined,
): boolean {
  if (!interaction?.guildId || interaction.user.bot) return false;
  if (
    interaction.isChatInputCommand() &&
    (interaction.commandName === 'coinflip' ||
      interaction.commandName === 'highlow' ||
      interaction.commandName === 'blackjack')
  ) {
    return true;
  }
  return (
    interaction.isButton() && interaction.customId?.startsWith('herta:mini-games:v1:') === true
  );
}

async function maybeAutoSync(
  context: CommunityChallengeContext,
  guildId: string,
  userId: string,
  target: CompletionNotificationTarget,
  force = false,
): Promise<void> {
  const config = normalizeCommunityChallengeConfig(context.config);
  if (!config.enabled || !config.autoSync) return;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = autoSyncLastAt.get(key);
  if (!force && last !== undefined && now - last < config.autoSyncCooldownSeconds * 1000) return;
  const states = await syncEnabledPeriods(context, guildId, userId, config);
  rememberAutoSync(key, now);
  const newlyCompleted = states.flatMap((state) => state.newlyCompleted);
  if (newlyCompleted.length > 0 && config.notifyCompletions) {
    await sendCompletionNotification(context, target, config, guildId, userId, newlyCompleted);
  }
}

async function sendCompletionNotification(
  context: CommunityChallengeContext,
  target: CompletionNotificationTarget,
  config: CommunityChallengeConfig,
  guildId: string,
  userId: string,
  newlyCompleted: readonly NewlyCompletedChallenge[],
): Promise<void> {
  const season = getCommunitySeasonWindow();
  const summary = await getCommunitySeasonSummary(context.prisma, guildId, userId, season.key);
  const earned = newlyCompleted.reduce((total, entry) => total + entry.points, 0);
  const content = [
    `🎯 <@${userId}> が **${newlyCompleted.length}個のChallengeをClear！** · +${earned}pt`,
    ...newlyCompleted
      .slice(0, 6)
      .map(
        ({ definition, points }) => `• ${definition.emoji} **${definition.name}** · +${points}pt`,
      ),
    ...(newlyCompleted.length > 6 ? [`• ほか ${newlyCompleted.length - 6}個`] : []),
    `Season合計 **${summary.points.toLocaleString()}pt**`,
  ].join('\n');
  const options: ReplyOptions = {
    content,
    allowedMentions: {
      parse: [],
      ...(config.mentionOnCompletion ? { users: [userId] } : {}),
    },
  };

  if (config.completionChannelId && target.guild) {
    try {
      const channel = await target.guild.channels.fetch(config.completionChannelId);
      if (channel?.isTextBased()) {
        await channel.send(options);
        return;
      }
    } catch (error) {
      context.logger.warn(
        { err: error, guildId, channelId: config.completionChannelId, userId },
        'Challenge完了通知チャンネルへの送信に失敗しました',
      );
    }
  }
  if (!target.reply) return;
  try {
    await target.reply(options);
  } catch (error) {
    context.logger.warn({ err: error, guildId, userId }, 'Challenge完了通知の送信に失敗しました');
  }
}

export function progressBar(current: number, target: number, width = 10): string {
  const safeTarget = Math.max(1, target);
  const ratio = Math.max(0, Math.min(1, current / safeTarget));
  const filled = ratio >= 1 ? width : Math.floor(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function voiceActivityMayHaveClosed(
  oldState: ChallengeVoiceState,
  newState: ChallengeVoiceState,
): boolean {
  if (!oldState.channelId) return false;
  return (
    oldState.channelId !== newState.channelId ||
    oldState.selfMute !== newState.selfMute ||
    oldState.serverMute !== newState.serverMute ||
    oldState.selfDeaf !== newState.selfDeaf ||
    oldState.serverDeaf !== newState.serverDeaf
  );
}

function rememberAutoSync(key: string, value: number): void {
  autoSyncLastAt.set(key, value);
  if (autoSyncLastAt.size <= AUTO_SYNC_CACHE_LIMIT) return;
  const oldest = autoSyncLastAt.keys().next().value as string | undefined;
  if (oldest) autoSyncLastAt.delete(oldest);
}

function clearAutoSyncGuild(guildId: string): void {
  for (const key of autoSyncLastAt.keys()) {
    if (key.startsWith(`${guildId}:`)) autoSyncLastAt.delete(key);
  }
}

async function replyPrivate(
  interaction: CommunityChallengeInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
}

function readPeriod(value: unknown): CommunityChallengePeriod | undefined {
  return value === 'daily' || value === 'weekly' ? value : undefined;
}

function nullableDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
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

function previousDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
