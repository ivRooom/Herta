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
import {
  customAchievementUnlockId,
  findCustomAchievementStage,
  normalizeCustomAchievementSeries,
  unlockedCustomAchievementIds,
  type CustomAchievementSeries,
  type CustomAchievementStage,
} from './custom-achievements.js';

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
  customAchievements: CustomAchievementSeries[];
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
  guild?: AchievementGuild | null;
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

interface AchievementMember {
  roles: { add(roleId: string): Promise<unknown> };
}

interface AchievementGuild {
  id: string;
  channels: { fetch(channelId: string): Promise<AchievementChannel | null> };
  members?: { fetch(userId: string): Promise<AchievementMember | null> };
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

interface MiniGameAchievementInteraction {
  guildId: string | null;
  user: { id: string; bot?: boolean };
  guild: AchievementGuild | null;
  commandName?: string;
  customId?: string;
  isChatInputCommand(): boolean;
  isButton(): boolean;
}

interface AchievementNotificationTarget {
  guild: AchievementGuild | null;
  reply?: (options: ReplyOptions) => Promise<unknown>;
}

interface AchievementPresentation {
  id: string;
  emoji: string;
  name: string;
  rarity: AchievementRarity;
  points: number;
  secret: boolean;
  notificationChannelId: string | null;
  rewardRoleId: string | null;
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
        event: 'interactionCreate',
        async handler(context, ...args) {
          scheduleMiniGameAchievementSync(
            context as AchievementsRuntimeContext,
            args[0] as MiniGameAchievementInteraction | undefined,
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
    customAchievements: normalizeCustomAchievementSeries(source.customAchievements),
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

export function unlockedAchievementIdsWithCustom(
  metrics: AchievementMetrics,
  config: AchievementsConfig,
): string[] {
  return [
    ...unlockedAchievementIds(metrics),
    ...unlockedCustomAchievementIds(config.customAchievements, metrics),
  ];
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
    .filter((id) => isKnownAchievementId(id, config));
  const staticLines = ACHIEVEMENTS.flatMap((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    if (filter.category && achievement.category !== filter.category) return [];
    if (filter.rarity && achievement.rarity !== filter.rarity) return [];
    if (filter.status === 'unlocked' && !isUnlocked) return [];
    if (filter.status === 'locked' && isUnlocked) return [];
    if (!isUnlocked && !config.showLocked) return [];
    if (!isUnlocked && achievement.secret && config.hideSecretUntilUnlocked) return [];

    const unlockedAt = unlocked.get(achievement.id);
    const rarity = config.showRarity ? ` · ${achievementRarityLabel(achievement.rarity)}` : '';
    const points = config.showScore ? ` · ${achievementPoints(achievement)}pt` : '';
    if (unlockedAt) {
      return [`${achievement.emoji} **${achievement.name}**${rarity}${points} · ✅ 解除済み`];
    }
    const progress = config.showProgress
      ? ` · ${formatAchievementProgress(achievement, metrics)}`
      : '';
    return [`🔒 **${achievement.name}**${rarity}${points}${progress}`];
  });

  const customLines = enabledCustomStages(config).flatMap(({ series, stage }) => {
    const id = customAchievementUnlockId(series.key, stage.key);
    const isUnlocked = unlocked.has(id);
    if (filter.category && series.category !== filter.category) return [];
    if (filter.rarity && stage.rarity !== filter.rarity) return [];
    if (filter.status === 'unlocked' && !isUnlocked) return [];
    if (filter.status === 'locked' && isUnlocked) return [];
    if (!isUnlocked && !config.showLocked) return [];
    if (!isUnlocked && stage.secret && config.hideSecretUntilUnlocked) return [];

    const rarity = config.showRarity ? ` · ${achievementRarityLabel(stage.rarity)}` : '';
    const points = config.showScore ? ` · ${stage.points.toLocaleString()}pt` : '';
    const level = ` · ${series.name}`;
    if (isUnlocked)
      return [`${stage.emoji} **${stage.name}**${level}${rarity}${points} · ✅ 解除済み`];
    const progress = config.showProgress ? ` · ${formatCustomProgress(stage, metrics)}` : '';
    return [`🔒 **${stage.name}**${level}${rarity}${points}${progress}`];
  });

  const total = ACHIEVEMENTS.length + enabledCustomStages(config).length;
  const score =
    achievementScoreForIds(knownUnlockedIds.filter((id) => achievementById.has(id))) +
    customAchievementScoreForIds(knownUnlockedIds, config);
  const scoreText = config.showScore ? ` · **${score.toLocaleString()}pt**` : '';
  const header = `**🏅 <@${userId}> のAchievements — ${knownUnlockedIds.length}/${total} unlocked${scoreText}**`;
  const lines = [...staticLines, ...customLines];
  if (lines.length === 0) return [[header, '条件に一致する実績はありません。'].join('\n')];
  return chunkLines(header, lines, config.pageSize);
}

export function formatAchievementLeaderboard(
  records: readonly AchievementLeaderboardRecord[],
  config?: AchievementsConfig,
): string {
  if (records.length === 0)
    return '**🏆 Badge Leaderboard**\nまだAchievement解除データがありません。';
  const total = ACHIEVEMENTS.length + (config ? enabledCustomStages(config).length : 0);
  const lines = records.map((record, index) => {
    const recognizedIds = config
      ? record.achievementIds.filter((id) => isKnownAchievementId(id, config))
      : record.achievementIds.filter((id) => achievementById.has(id));
    const score =
      achievementScoreForIds(recognizedIds.filter((id) => achievementById.has(id))) +
      (config ? customAchievementScoreForIds(recognizedIds, config) : 0);
    return `${index + 1}. <@${record.userId}> — **${recognizedIds.length}/${total}** · **${score.toLocaleString()}pt**`;
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
  const config = normalizeAchievementsConfig(context.config);
  const metrics = await getAchievementMetrics(context.prisma, guildId, userId);
  const newlyUnlocked = await syncAchievementUnlocks(
    context.prisma,
    guildId,
    userId,
    unlockedAchievementIdsWithCustom(metrics, config),
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
  const target: AchievementNotificationTarget = { guild: interaction.guild ?? null };
  await applyCustomAchievementRewards(context, target, config, interaction.user.id, newlyUnlocked);
  const unlockedDefinitions = newlyUnlocked.flatMap((id) => {
    const presentation = achievementPresentation(id, config);
    return presentation ? [presentation] : [];
  });
  const total = ACHIEVEMENTS.length + enabledCustomStages(config).length;
  const unlockedCount = unlocks.filter((record) =>
    isKnownAchievementId(record.achievementId, config),
  ).length;
  const content =
    unlockedDefinitions.length > 0
      ? [
          `🏅 **${unlockedDefinitions.length}個のAchievementを新しく解除しました！**`,
          ...unlockedDefinitions.map(
            (achievement) =>
              `• ${achievement.emoji} ${achievement.name} · ${achievementRarityLabel(achievement.rarity)} · ${achievement.points.toLocaleString()}pt`,
          ),
          `現在 ${unlockedCount}/${total}`,
        ].join('\n')
      : `同期しました。新しい解除はありません。現在 ${unlockedCount}/${total} です。`;
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
  const userId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const { metrics, unlocks } = await loadAndSync(context, interaction.guildId, userId);
  const unlocked = unlocks.find((record) => record.achievementId === id);
  const achievement = achievementById.get(id);
  if (achievement) {
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
    return;
  }

  const custom = findCustomAchievementStage(config.customAchievements, id);
  if (!custom) {
    return reply(
      interaction,
      'そのAchievement IDは見つかりません。`/achievements`で一覧を確認してください。',
    );
  }
  if (custom.stage.secret && config.hideSecretUntilUnlocked && !unlocked) {
    return reply(interaction, '🌌 **Secret Achievement**\n条件は解除するまで非公開です。');
  }
  await interaction.reply({
    content: [
      `${custom.stage.emoji} **${custom.stage.name}** · ${custom.series.name}`,
      `ID: \`${id}\``,
      `Category: **${custom.series.category}**`,
      `Rarity: **${achievementRarityLabel(custom.stage.rarity)}** · **${custom.stage.points.toLocaleString()}pt**`,
      custom.stage.description || '説明は設定されていません。',
      unlocked
        ? `Status: ✅ 解除済み · <t:${Math.floor(unlocked.unlockedAt.getTime() / 1000)}:R>`
        : `Status: 🔒 未解除 · ${formatCustomProgress(custom.stage, metrics)}`,
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
    content: formatAchievementLeaderboard(records, config),
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

export function isMiniGameAchievementInteraction(
  interaction: MiniGameAchievementInteraction | undefined,
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

function scheduleMiniGameAchievementSync(
  context: AchievementsRuntimeContext,
  interaction: MiniGameAchievementInteraction | undefined,
): void {
  if (!isMiniGameAchievementInteraction(interaction) || !interaction?.guildId) return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const target: AchievementNotificationTarget = { guild: interaction.guild };
  const timer = setTimeout(() => {
    void maybeAutoSync(context, guildId, userId, target, true).catch((error) => {
      context.logger.warn(
        { err: error, guildId, userId },
        'Mini Games後のAchievement同期に失敗しました',
      );
    });
  }, 400);
  timer.unref?.();
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
    unlockedAchievementIdsWithCustom(metrics, config),
  );
  rememberAutoSync(key, now);
  if (newlyUnlocked.length === 0) return;
  await applyCustomAchievementRewards(context, target, config, userId, newlyUnlocked);
  if (config.notifyUnlocks) {
    await sendUnlockNotification(context, target, config, userId, newlyUnlocked);
  }
}

async function applyCustomAchievementRewards(
  context: AchievementsRuntimeContext,
  target: AchievementNotificationTarget,
  config: AchievementsConfig,
  userId: string,
  newlyUnlocked: readonly string[],
): Promise<void> {
  if (!target.guild?.members) return;
  const roleIds = new Set(
    newlyUnlocked.flatMap((id) => {
      const custom = findCustomAchievementStage(config.customAchievements, id);
      return custom?.stage.rewardRoleId ? [custom.stage.rewardRoleId] : [];
    }),
  );
  if (roleIds.size === 0) return;

  try {
    const member = await target.guild.members.fetch(userId);
    if (!member) return;
    for (const roleId of roleIds) {
      try {
        await member.roles.add(roleId);
      } catch (error) {
        context.logger.warn(
          { err: error, guildId: target.guild.id, userId, roleId },
          'Custom Achievement報酬Roleの付与に失敗しました',
        );
      }
    }
  } catch (error) {
    context.logger.warn(
      { err: error, guildId: target.guild.id, userId },
      'Custom Achievement報酬対象メンバーの取得に失敗しました',
    );
  }
}

async function sendUnlockNotification(
  context: AchievementsRuntimeContext,
  target: AchievementNotificationTarget,
  config: AchievementsConfig,
  userId: string,
  newlyUnlocked: readonly string[],
): Promise<void> {
  const presentations = newlyUnlocked
    .flatMap((id) => {
      const achievement = achievementPresentation(id, config);
      return achievement ? [achievement] : [];
    })
    .filter(
      (achievement) =>
        ACHIEVEMENT_RARITY_ORDER[achievement.rarity] >=
        ACHIEVEMENT_RARITY_ORDER[config.notificationMinimumRarity],
    );
  if (presentations.length === 0) return;

  const groups = new Map<string, AchievementPresentation[]>();
  for (const achievement of presentations) {
    const destination = achievement.notificationChannelId ?? config.unlockChannelId ?? '__reply__';
    const list = groups.get(destination) ?? [];
    list.push(achievement);
    groups.set(destination, list);
  }

  for (const [destination, definitions] of groups) {
    const points = definitions.reduce((total, achievement) => total + achievement.points, 0);
    const shown = definitions.slice(0, 10);
    const content = [
      `🏅 <@${userId}> が **${definitions.length}個のAchievementを解除！** · +${points.toLocaleString()}pt`,
      ...shown.map(
        (achievement) =>
          `• ${achievement.emoji} **${achievement.name}** · ${achievementRarityLabel(achievement.rarity)}`,
      ),
      ...(definitions.length > shown.length
        ? [`• ほか ${definitions.length - shown.length}個`]
        : []),
    ].join('\n');
    const options: ReplyOptions = {
      content,
      allowedMentions: {
        parse: [],
        ...(config.mentionOnUnlock ? { users: [userId] } : {}),
      },
    };

    if (destination !== '__reply__' && target.guild) {
      try {
        const channel = await target.guild.channels.fetch(destination);
        if (channel?.isTextBased()) {
          await channel.send(options);
          continue;
        }
      } catch (error) {
        context.logger.warn(
          { err: error, guildId: target.guild.id, channelId: destination, userId },
          'Achievement解除通知チャンネルへの送信に失敗しました',
        );
      }
    }

    if (!target.reply) continue;
    try {
      await target.reply(options);
    } catch (error) {
      context.logger.warn(
        { err: error, guildId: target.guild?.id, userId },
        'Achievement解除通知の送信に失敗しました',
      );
    }
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

function formatCustomProgress(stage: CustomAchievementStage, metrics: AchievementMetrics): string {
  const completed = stage.conditions.filter(
    (condition) => metrics[condition.metric] >= condition.target,
  ).length;
  if (stage.conditions.length > 1) {
    return `${stage.conditionMode === 'any' ? 'ANY' : 'ALL'} ${completed}/${stage.conditions.length}`;
  }
  const condition = stage.conditions[0];
  if (!condition) return '進捗なし';
  const current = Math.min(metrics[condition.metric], condition.target);
  if (condition.metric === 'voiceSeconds' || condition.metric === 'minecraftSeconds') {
    return `${formatDuration(current)}/${formatDuration(condition.target)}`;
  }
  return `${current.toLocaleString()}/${condition.target.toLocaleString()}`;
}

function achievementPresentation(
  id: string,
  config: AchievementsConfig,
): AchievementPresentation | undefined {
  const builtIn = achievementById.get(id);
  if (builtIn) {
    return {
      id,
      emoji: builtIn.emoji,
      name: builtIn.name,
      rarity: builtIn.rarity,
      points: achievementPoints(builtIn),
      secret: builtIn.secret === true,
      notificationChannelId: null,
      rewardRoleId: null,
    };
  }
  const custom = findCustomAchievementStage(config.customAchievements, id);
  if (!custom || !custom.series.enabled) return undefined;
  return {
    id,
    emoji: custom.stage.emoji,
    name: `${custom.series.name} · ${custom.stage.name}`,
    rarity: custom.stage.rarity,
    points: custom.stage.points,
    secret: custom.stage.secret,
    notificationChannelId: custom.stage.notificationChannelId,
    rewardRoleId: custom.stage.rewardRoleId,
  };
}

function enabledCustomStages(
  config: AchievementsConfig,
): Array<{ series: CustomAchievementSeries; stage: CustomAchievementStage }> {
  return config.customAchievements.flatMap((series) =>
    series.enabled ? series.stages.map((stage) => ({ series, stage })) : [],
  );
}

function isKnownAchievementId(id: string, config: AchievementsConfig): boolean {
  return (
    achievementById.has(id) || Boolean(findCustomAchievementStage(config.customAchievements, id))
  );
}

function customAchievementScoreForIds(ids: readonly string[], config: AchievementsConfig): number {
  return ids.reduce((total, id) => {
    const custom = findCustomAchievementStage(config.customAchievements, id);
    return total + (custom?.series.enabled ? custom.stage.points : 0);
  }, 0);
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
