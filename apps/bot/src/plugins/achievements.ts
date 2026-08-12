import type { PrismaClient } from '@herta/db';
import { achievementsManifest } from '@herta/plugin-catalog';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_RARITY_ORDER,
  achievementCategoryLabel,
  achievementPoints,
  achievementRarityLabel,
  achievementScoreForIds,
  isAchievementCategory,
  isAchievementRarity,
  type AchievementCategory,
  type AchievementDefinition,
  type AchievementRarity,
} from '@herta/shared';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import {
  getAchievementMetrics,
  listAchievementLeaderboard,
  listAchievementUnlocks,
  syncAchievementUnlocks,
  type AchievementLeaderboardRecord,
  type AchievementMetrics,
  type AchievementUnlockRecord,
} from './achievements-repository.js';

const EPHEMERAL_FLAG = 64;
const DISCORD_ID_PATTERN = /^\d+$/;
const AUTO_SYNC_CACHE_LIMIT = 20_000;
const autoSyncLastAt = new Map<string, number>();

type AchievementStatusFilter = 'unlocked' | 'locked';

export { ACHIEVEMENTS, achievementPoints, achievementScoreForIds };
export type { AchievementCategory, AchievementDefinition, AchievementRarity };

const achievementById = ACHIEVEMENT_BY_ID;

export interface AchievementsConfig {
  enabled: boolean;
  autoSync: boolean;
  autoSyncCooldownSeconds: number;
  ephemeralSync: boolean;
  notifyUnlocks: boolean;
  unlockChannelId: string | null;
  mentionOnUnlock: boolean;
  notificationMinimumRarity: AchievementRarity;
  showLocked: boolean;
  showProgress: boolean;
  showScore: boolean;
  showRarity: boolean;
  hideSecretUntilUnlocked: boolean;
  pageSize: number;
  leaderboardSize: number;
}

export interface AchievementListFilter {
  category?: AchievementCategory;
  rarity?: AchievementRarity;
  status?: AchievementStatusFilter;
}

interface AchievementCommandInteraction {
  guildId: string | null;
  user: { id: string };
  options: {
    getUser(name: string): { id: string } | null;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string): number | null;
    getSubcommand(): string;
  };
  reply(options: ReplyOptions): Promise<unknown>;
  followUp(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: []; users?: string[] };
}

interface AchievementChannel {
  isTextBased(): boolean;
  send(options: ReplyOptions): Promise<unknown>;
}

interface AchievementGuild {
  id: string;
  channels: { fetch(channelId: string): Promise<AchievementChannel | null> };
}

interface AchievementMessage {
  guildId: string | null;
  author: { id: string; bot?: boolean };
  guild: AchievementGuild | null;
  reply(options: ReplyOptions): Promise<unknown>;
}

interface AchievementReaction {
  message: AchievementMessage;
}

interface AchievementReactionUser {
  id: string;
  bot?: boolean;
}

interface AchievementVoiceMember {
  user: { bot?: boolean };
}

interface AchievementVoiceState {
  id: string;
  channelId: string | null;
  selfMute?: boolean | null;
  serverMute?: boolean | null;
  selfDeaf?: boolean | null;
  serverDeaf?: boolean | null;
  member?: AchievementVoiceMember | null;
  guild: AchievementGuild;
}

interface AchievementNotificationTarget {
  guild: AchievementGuild | null;
  reply?: (options: ReplyOptions) => Promise<unknown>;
}

type AchievementsRuntimeContext = PluginRuntimeContext<AchievementsConfig, unknown, PrismaClient>;

export const achievementsPlugin = definePlugin<AchievementsConfig, unknown, PrismaClient>({
  manifest: achievementsManifest,
  provideCommands(context) {
    const list: CommandHandler<AchievementCommandInteraction> = {
      definition: achievementsManifest.commands[0]!,
      async execute(interaction) {
        await executeAchievements(context, interaction);
      },
    };
    const manage: CommandHandler<AchievementCommandInteraction> = {
      definition: achievementsManifest.commands[1]!,
      async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'sync') await executeSync(context, interaction);
        else if (subcommand === 'info') await executeInfo(context, interaction);
        else if (subcommand === 'leaderboard') await executeLeaderboard(context, interaction);
      },
    };
    return [list, manage];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleAchievementMessage(
            context as AchievementsRuntimeContext,
            args[0] as AchievementMessage | undefined,
          );
        },
      },
      {
        event: 'messageReactionAdd',
        async handler(context, ...args) {
          await handleAchievementReaction(
            context as AchievementsRuntimeContext,
            args[0] as AchievementReaction | undefined,
            args[1] as AchievementReactionUser | undefined,
          );
        },
      },
      {
        event: 'voiceStateUpdate',
        async handler(context, ...args) {
          await handleAchievementVoice(
            context as AchievementsRuntimeContext,
            args[0] as AchievementVoiceState | undefined,
            args[1] as AchievementVoiceState | undefined,
          );
        },
      },
    ] as PluginEventHandler<AchievementsConfig>[];
  },
  async onDisable(context) {
    clearAutoSyncGuild(context.guildId);
  },
});

export function normalizeAchievementsConfig(value: unknown): AchievementsConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    autoSync: source.autoSync === undefined ? true : source.autoSync === true,
    autoSyncCooldownSeconds: clamp(toInteger(source.autoSyncCooldownSeconds, 30), 10, 600),
    ephemeralSync: source.ephemeralSync === undefined ? true : source.ephemeralSync === true,
    notifyUnlocks: source.notifyUnlocks === undefined ? true : source.notifyUnlocks === true,
    unlockChannelId: nullableDiscordId(source.unlockChannelId),
    mentionOnUnlock: source.mentionOnUnlock === true,
    notificationMinimumRarity: readRarity(source.notificationMinimumRarity) ?? 'common',
    showLocked: source.showLocked === undefined ? true : source.showLocked === true,
    showProgress: source.showProgress === undefined ? true : source.showProgress === true,
    showScore: source.showScore === undefined ? true : source.showScore === true,
    showRarity: source.showRarity === undefined ? true : source.showRarity === true,
    hideSecretUntilUnlocked:
      source.hideSecretUntilUnlocked === undefined ? true : source.hideSecretUntilUnlocked === true,
    pageSize: clamp(toInteger(source.pageSize, 10), 5, 20),
    leaderboardSize: clamp(toInteger(source.leaderboardSize, 10), 5, 25),
  };
}

export function unlockedAchievementIds(metrics: AchievementMetrics): string[] {
  return ACHIEVEMENTS.filter((achievement) => isAchievementUnlocked(achievement, metrics)).map(
    (achievement) => achievement.id,
  );
}

export function formatAchievements(
  userId: string,
  metrics: AchievementMetrics,
  unlocks: readonly AchievementUnlockRecord[],
  config: AchievementsConfig,
  filter: AchievementListFilter = {},
): string[] {
  const unlocked = new Map(unlocks.map((record) => [record.achievementId, record.unlockedAt]));
  const knownUnlockedIds = unlocks
    .map((record) => record.achievementId)
    .filter((id) => achievementById.has(id));
  const visible = ACHIEVEMENTS.filter((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    if (filter.category && achievement.category !== filter.category) return false;
    if (filter.rarity && achievement.rarity !== filter.rarity) return false;
    if (filter.status === 'unlocked' && !isUnlocked) return false;
    if (filter.status === 'locked' && isUnlocked) return false;
    if (isUnlocked) return true;
    if (!config.showLocked) return false;
    return !(achievement.secret && config.hideSecretUntilUnlocked);
  });
  const lines = visible.map((achievement) => {
    const unlockedAt = unlocked.get(achievement.id);
    const rarity = config.showRarity ? ` · ${achievementRarityLabel(achievement.rarity)}` : '';
    const points = config.showScore ? ` · ${achievementPoints(achievement)}pt` : '';
    if (unlockedAt) {
      return `${achievement.emoji} **${achievement.name}**${rarity}${points} · ✅ 解除済み`;
    }
    const progress = config.showProgress
      ? ` · ${formatAchievementProgress(achievement, metrics)}`
      : '';
    return `🔒 **${achievement.name}**${rarity}${points}${progress}`;
  });
  const score = achievementScoreForIds(knownUnlockedIds);
  const scoreText = config.showScore ? ` · **${score.toLocaleString()}pt**` : '';
  const header = `**🏅 <@${userId}> のAchievements — ${knownUnlockedIds.length}/${ACHIEVEMENTS.length} unlocked${scoreText}**`;
  if (lines.length === 0) return [[header, '条件に一致する実績はありません。'].join('\n')];
  return chunkLines(header, lines, config.pageSize);
}

export function formatAchievementLeaderboard(
  records: readonly AchievementLeaderboardRecord[],
): string {
  if (records.length === 0)
    return '**🏆 Badge Leaderboard**\nまだAchievement解除データがありません。';
  const lines = records.map((record, index) => {
    const score = achievementScoreForIds(record.achievementIds);
    return `${index + 1}. <@${record.userId}> — **${record.unlockCount}/${ACHIEVEMENTS.length}** · **${score.toLocaleString()}pt**`;
  });
  return ['**🏆 Badge Leaderboard · 解除数順**', ...lines].join('\n');
}

async function loadAndSync(
  context: AchievementsRuntimeContext,
  guildId: string,
  userId: string,
): Promise<{
  metrics: AchievementMetrics;
  unlocks: AchievementUnlockRecord[];
  newlyUnlocked: string[];
}> {
  const metrics = await getAchievementMetrics(context.prisma, guildId, userId);
  const newlyUnlocked = await syncAchievementUnlocks(
    context.prisma,
    guildId,
    userId,
    unlockedAchievementIds(metrics),
  );
  const unlocks = await listAchievementUnlocks(context.prisma, guildId, userId);
  return { metrics, unlocks, newlyUnlocked };
}

async function executeAchievements(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const filter: AchievementListFilter = {
    ...(readCategory(interaction.options.getString('category'))
      ? { category: readCategory(interaction.options.getString('category'))! }
      : {}),
    ...(readRarity(interaction.options.getString('rarity'))
      ? { rarity: readRarity(interaction.options.getString('rarity'))! }
      : {}),
    ...(readStatus(interaction.options.getString('status'))
      ? { status: readStatus(interaction.options.getString('status'))! }
      : {}),
  };
  const { metrics, unlocks } = await loadAndSync(context, interaction.guildId, userId);
  const pages = formatAchievements(userId, metrics, unlocks, config, filter);
  await interaction.reply({ content: pages[0]!, allowedMentions: { parse: [] } });
  for (const page of pages.slice(1)) {
    await interaction.followUp({ content: page, allowedMentions: { parse: [] } });
  }
}

async function executeSync(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const { newlyUnlocked, unlocks } = await loadAndSync(
    context,
    interaction.guildId,
    interaction.user.id,
  );
  const unlockedDefinitions = newlyUnlocked.flatMap((id) => {
    const achievement = achievementById.get(id);
    return achievement ? [achievement] : [];
  });
  const content =
    unlockedDefinitions.length > 0
      ? [
          `🏅 **${unlockedDefinitions.length}個のAchievementを新しく解除しました！**`,
          ...unlockedDefinitions.map(
            (achievement) =>
              `• ${achievement.emoji} ${achievement.name} · ${achievementRarityLabel(achievement.rarity)} · ${achievementPoints(achievement)}pt`,
          ),
          `現在 ${unlocks.filter((record) => achievementById.has(record.achievementId)).length}/${ACHIEVEMENTS.length}`,
        ].join('\n')
      : `同期しました。新しい解除はありません。現在 ${unlocks.filter((record) => achievementById.has(record.achievementId)).length}/${ACHIEVEMENTS.length} です。`;
  await interaction.reply({
    content,
    flags: config.ephemeralSync ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

async function executeInfo(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const id = interaction.options.getString('id', true)?.trim().toLowerCase() ?? '';
  const achievement = achievementById.get(id);
  if (!achievement)
    return reply(
      interaction,
      'そのAchievement IDは見つかりません。`/achievements`で一覧を確認してください。',
    );
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const { metrics, unlocks } = await loadAndSync(context, interaction.guildId, userId);
  const unlocked = unlocks.find((record) => record.achievementId === id);
  if (achievement.secret && config.hideSecretUntilUnlocked && !unlocked) {
    return reply(interaction, '🌌 **Secret Achievement**\n条件は解除するまで非公開です。');
  }
  await interaction.reply({
    content: [
      `${achievement.emoji} **${achievement.name}**`,
      `ID: \`${achievement.id}\``,
      `Category: **${achievementCategoryLabel(achievement.category)}**`,
      `Rarity: **${achievementRarityLabel(achievement.rarity)}** · **${achievementPoints(achievement)}pt**`,
      achievement.description,
      unlocked
        ? `Status: ✅ 解除済み · <t:${Math.floor(unlocked.unlockedAt.getTime() / 1000)}:R>`
        : `Status: 🔒 未解除 · ${formatAchievementProgress(achievement, metrics)}`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

async function executeLeaderboard(
  context: AchievementsRuntimeContext,
  interaction: AchievementCommandInteraction,
): Promise<void> {
  if (!interaction.guildId)
    return reply(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled) return reply(interaction, 'Achievements Pluginは現在無効です。');
  const limit = clamp(interaction.options.getInteger('limit') ?? config.leaderboardSize, 5, 25);
  const records = await listAchievementLeaderboard(context.prisma, interaction.guildId, limit);
  await interaction.reply({
    content: formatAchievementLeaderboard(records),
    allowedMentions: { parse: [] },
  });
}

async function handleAchievementMessage(
  context: AchievementsRuntimeContext,
  message: AchievementMessage | undefined,
): Promise<void> {
  if (!message?.guildId || message.author.bot) return;
  await maybeAutoSync(context, message.guildId, message.author.id, {
    guild: message.guild,
    reply: (options) => message.reply(options),
  });
}

async function handleAchievementReaction(
  context: AchievementsRuntimeContext,
  reaction: AchievementReaction | undefined,
  user: AchievementReactionUser | undefined,
): Promise<void> {
  const message = reaction?.message;
  if (!message?.guildId || !user || user.bot) return;
  const target: AchievementNotificationTarget = {
    guild: message.guild,
    reply: (options) => message.reply(options),
  };
  await maybeAutoSync(context, message.guildId, user.id, target);
  if (!message.author.bot && message.author.id !== user.id) {
    await maybeAutoSync(context, message.guildId, message.author.id, target);
  }
}

async function handleAchievementVoice(
  context: AchievementsRuntimeContext,
  oldState: AchievementVoiceState | undefined,
  newState: AchievementVoiceState | undefined,
): Promise<void> {
  if (!oldState || !newState || newState.member?.user.bot || oldState.member?.user.bot) return;
  if (!voiceActivityMayHaveClosed(oldState, newState)) return;
  await maybeAutoSync(context, newState.guild.id, newState.id, { guild: newState.guild }, true);
}

async function maybeAutoSync(
  context: AchievementsRuntimeContext,
  guildId: string,
  userId: string,
  target: AchievementNotificationTarget,
  force = false,
): Promise<void> {
  const config = normalizeAchievementsConfig(context.config);
  if (!config.enabled || !config.autoSync) return;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = autoSyncLastAt.get(key);
  if (!force && last !== undefined && now - last < config.autoSyncCooldownSeconds * 1000) return;

  const metrics = await getAchievementMetrics(context.prisma, guildId, userId);
  const newlyUnlocked = await syncAchievementUnlocks(
    context.prisma,
    guildId,
    userId,
    unlockedAchievementIds(metrics),
  );
  rememberAutoSync(key, now);
  if (newlyUnlocked.length > 0 && config.notifyUnlocks) {
    await sendUnlockNotification(context, target, config, userId, newlyUnlocked);
  }
}

async function sendUnlockNotification(
  context: AchievementsRuntimeContext,
  target: AchievementNotificationTarget,
  config: AchievementsConfig,
  userId: string,
  newlyUnlocked: readonly string[],
): Promise<void> {
  const definitions = newlyUnlocked
    .flatMap((id) => {
      const achievement = achievementById.get(id);
      return achievement ? [achievement] : [];
    })
    .filter(
      (achievement) =>
        ACHIEVEMENT_RARITY_ORDER[achievement.rarity] >=
        ACHIEVEMENT_RARITY_ORDER[config.notificationMinimumRarity],
    );
  if (definitions.length === 0) return;

  const points = definitions.reduce(
    (total, achievement) => total + achievementPoints(achievement),
    0,
  );
  const shown = definitions.slice(0, 10);
  const content = [
    `🏅 <@${userId}> が **${definitions.length}個のAchievementを解除！** · +${points.toLocaleString()}pt`,
    ...shown.map(
      (achievement) =>
        `• ${achievement.emoji} **${achievement.name}** · ${achievementRarityLabel(achievement.rarity)}`,
    ),
    ...(definitions.length > shown.length ? [`• ほか ${definitions.length - shown.length}個`] : []),
  ].join('\n');
  const options: ReplyOptions = {
    content,
    allowedMentions: {
      parse: [],
      ...(config.mentionOnUnlock ? { users: [userId] } : {}),
    },
  };

  if (config.unlockChannelId && target.guild) {
    try {
      const channel = await target.guild.channels.fetch(config.unlockChannelId);
      if (channel?.isTextBased()) {
        await channel.send(options);
        return;
      }
    } catch (error) {
      context.logger.warn(
        { err: error, guildId: target.guild.id, channelId: config.unlockChannelId, userId },
        'Achievement解除通知チャンネルへの送信に失敗しました',
      );
    }
  }

  if (!target.reply) return;
  try {
    await target.reply(options);
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: target.guild?.id, userId },
      'Achievement解除通知の送信に失敗しました',
    );
  }
}

function isAchievementUnlocked(
  achievement: AchievementDefinition,
  metrics: AchievementMetrics,
): boolean {
  if (achievement.id === 'community-legend') {
    return (
      metrics.xp >= 5000 &&
      metrics.pollVotes >= 10 &&
      metrics.eventGoing >= 10 &&
      metrics.acceptedSuggestions >= 5
    );
  }
  if (achievement.id === 'all-rounder') {
    return (
      metrics.messages >= 500 &&
      metrics.voiceSeconds >= 18_000 &&
      metrics.reactionsGiven >= 100 &&
      metrics.reactionsReceived >= 50
    );
  }
  if (!achievement.metric || achievement.target === undefined) return false;
  return metrics[achievement.metric] >= achievement.target;
}

function formatAchievementProgress(
  achievement: AchievementDefinition,
  metrics: AchievementMetrics,
): string {
  if (achievement.id === 'community-legend') {
    const completed = [
      metrics.xp >= 5000,
      metrics.pollVotes >= 10,
      metrics.eventGoing >= 10,
      metrics.acceptedSuggestions >= 5,
    ].filter(Boolean).length;
    return `複合条件 ${completed}/4`;
  }
  if (achievement.id === 'all-rounder') {
    const completed = [
      metrics.messages >= 500,
      metrics.voiceSeconds >= 18_000,
      metrics.reactionsGiven >= 100,
      metrics.reactionsReceived >= 50,
    ].filter(Boolean).length;
    return `4分野 ${completed}/4`;
  }
  if (!achievement.metric || achievement.target === undefined) return '進捗なし';
  const current = Math.min(metrics[achievement.metric], achievement.target);
  if (achievement.metric === 'voiceSeconds' || achievement.metric === 'minecraftSeconds') {
    return `${formatDuration(current)}/${formatDuration(achievement.target)}`;
  }
  return `${current.toLocaleString()}/${achievement.target.toLocaleString()}`;
}

function voiceActivityMayHaveClosed(
  oldState: AchievementVoiceState,
  newState: AchievementVoiceState,
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

function chunkLines(header: string, lines: string[], pageSize: number): string[] {
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += pageSize) {
    const page = lines.slice(index, index + pageSize);
    pages.push(
      [pages.length === 0 ? header : `${header} · continued`, ...page].join('\n').slice(0, 1990),
    );
  }
  return pages;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

async function reply(interaction: AchievementCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
}

function readCategory(value: unknown): AchievementCategory | undefined {
  return isAchievementCategory(value) ? value : undefined;
}

function readRarity(value: unknown): AchievementRarity | undefined {
  return isAchievementRarity(value) ? value : undefined;
}

function readStatus(value: unknown): AchievementStatusFilter | undefined {
  return value === 'unlocked' || value === 'locked' ? value : undefined;
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
