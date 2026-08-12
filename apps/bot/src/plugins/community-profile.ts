import {
  addFeaturedAchievement,
  clearCommunityProfileTitle,
  clearFeaturedAchievements,
  getCommunityProfileSnapshotData,
  removeFeaturedAchievement,
  setCommunityProfileTitle,
  setCommunityProfileVisibility,
  type CommunityProfilePeriod,
  type CommunityProfileSnapshotData,
  type PrismaClient,
} from '@herta/db';
import { communityProfileManifest } from '@herta/plugin-catalog';
import { definePlugin, type CommandHandler, type PluginRuntimeContext } from '@herta/plugin-sdk';
import {
  ACHIEVEMENT_BY_ID,
  achievementPoints,
  achievementRarityLabel,
  summarizeAchievementCollection,
  type AchievementDefinition,
} from '@herta/shared';
import {
  appendCommunityProfileMilestones,
  appendCommunityProfileMomentum,
  appendCommunityProfileSeason,
  formatCommunityProfileComparison,
  getCommunityProfileV3Data,
  type CommunityProfileV3Data,
} from './community-profile-v3.js';
import { levelForXp, xpRequiredForLevel } from './xp-level.js';

const EPHEMERAL_FLAG = 64;
const achievementById = ACHIEVEMENT_BY_ID;

export interface CommunityProfileConfig {
  enabled: boolean;
  ephemeralResponses: boolean;
  allowViewingOthers: boolean;
  defaultActivityPeriod: CommunityProfilePeriod;
  showXp: boolean;
  showActivity: boolean;
  showAchievements: boolean;
  showAchievementCompletion: boolean;
  showAchievementRarityBreakdown: boolean;
  showProfileTitle: boolean;
  showRankings: boolean;
  showSeason: boolean;
  showSeasonProgress: boolean;
  showDailyChallengeStreak: boolean;
  showNextMilestones: boolean;
  nextMilestoneCount: number;
  showActivityMomentum: boolean;
  allowComparisons: boolean;
  showRecentAchievements: boolean;
  recentAchievementCount: number;
  featuredBadgeLimit: number;
  showMinecraftActivity: boolean;
  showZeroActivity: boolean;
}

interface CommunityProfileInteraction {
  guildId: string | null;
  user: { id: string };
  options: {
    getSubcommand(): string;
    getUser(name: string): { id: string } | null;
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
  };
  reply(options: ReplyOptions): Promise<unknown>;
}

interface ReplyOptions {
  content: string;
  flags?: number;
  allowedMentions: { parse: [] };
}

type CommunityProfileContext = PluginRuntimeContext<CommunityProfileConfig, unknown, PrismaClient>;

export const communityProfilePlugin = definePlugin<CommunityProfileConfig, unknown, PrismaClient>({
  manifest: communityProfileManifest,
  provideCommands(context) {
    const profile: CommandHandler<CommunityProfileInteraction> = {
      definition: communityProfileManifest.commands[0]!,
      async execute(interaction) {
        await executeProfileCommand(context, interaction);
      },
    };
    return [profile];
  },
});

export function normalizeCommunityProfileConfig(value: unknown): CommunityProfileConfig {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    ephemeralResponses:
      source.ephemeralResponses === undefined ? false : source.ephemeralResponses === true,
    allowViewingOthers:
      source.allowViewingOthers === undefined ? true : source.allowViewingOthers === true,
    defaultActivityPeriod: readPeriod(source.defaultActivityPeriod) ?? '30d',
    showXp: source.showXp === undefined ? true : source.showXp === true,
    showActivity: source.showActivity === undefined ? true : source.showActivity === true,
    showAchievements:
      source.showAchievements === undefined ? true : source.showAchievements === true,
    showAchievementCompletion:
      source.showAchievementCompletion === undefined
        ? true
        : source.showAchievementCompletion === true,
    showAchievementRarityBreakdown:
      source.showAchievementRarityBreakdown === undefined
        ? true
        : source.showAchievementRarityBreakdown === true,
    showProfileTitle:
      source.showProfileTitle === undefined ? true : source.showProfileTitle === true,
    showRankings: source.showRankings === undefined ? true : source.showRankings === true,
    showSeason: source.showSeason === undefined ? true : source.showSeason === true,
    showSeasonProgress:
      source.showSeasonProgress === undefined ? true : source.showSeasonProgress === true,
    showDailyChallengeStreak:
      source.showDailyChallengeStreak === undefined
        ? true
        : source.showDailyChallengeStreak === true,
    showNextMilestones:
      source.showNextMilestones === undefined ? true : source.showNextMilestones === true,
    nextMilestoneCount: clamp(toInteger(source.nextMilestoneCount, 3), 1, 5),
    showActivityMomentum:
      source.showActivityMomentum === undefined ? true : source.showActivityMomentum === true,
    allowComparisons:
      source.allowComparisons === undefined ? true : source.allowComparisons === true,
    showRecentAchievements:
      source.showRecentAchievements === undefined ? true : source.showRecentAchievements === true,
    recentAchievementCount: clamp(toInteger(source.recentAchievementCount, 3), 0, 5),
    featuredBadgeLimit: clamp(toInteger(source.featuredBadgeLimit, 3), 1, 5),
    showMinecraftActivity:
      source.showMinecraftActivity === undefined ? true : source.showMinecraftActivity === true,
    showZeroActivity: source.showZeroActivity === true,
  };
}

export function canViewCommunityProfile(
  viewerId: string,
  targetId: string,
  snapshot: CommunityProfileSnapshotData,
  config: CommunityProfileConfig,
): boolean {
  if (viewerId === targetId) return true;
  return config.allowViewingOthers && snapshot.preference.isPublic;
}

export function formatCommunityProfile(
  snapshot: CommunityProfileSnapshotData,
  config: CommunityProfileConfig,
  viewerId = snapshot.userId,
  v3Data?: CommunityProfileV3Data,
): string {
  const lines: string[] = [`**👤 <@${snapshot.userId}> Community Profile**`];

  if (viewerId === snapshot.userId && !snapshot.preference.isPublic) {
    lines.push('🔒 このプロフィールは現在非公開です。');
  }

  if (config.showProfileTitle) {
    const title = resolveProfileTitle(snapshot);
    if (title) lines.push(`${title.emoji} Title **${title.name}**`);
  }

  if (config.showXp) appendXp(lines, snapshot, config);
  if (v3Data && config.showSeason) {
    appendCommunityProfileSeason(lines, v3Data, {
      showRankings: config.showRankings,
      showProgress: config.showSeasonProgress,
      showDailyStreak: config.showDailyChallengeStreak,
    });
  }
  if (config.showAchievements) appendAchievements(lines, snapshot, config);
  if (v3Data && config.showNextMilestones) {
    appendCommunityProfileMilestones(lines, snapshot, v3Data, config.nextMilestoneCount);
  }
  if (config.showActivity) appendActivity(lines, snapshot, config);
  if (v3Data && config.showActivityMomentum) {
    appendCommunityProfileMomentum(lines, v3Data.momentum, config.showMinecraftActivity);
  }

  const featured = resolveFeaturedAchievements(snapshot, config.featuredBadgeLimit);
  lines.push('', '**🏷️ Badge Showcase**');
  if (featured.length === 0) {
    lines.push('まだBadgeが設定されていません。`/profile badge-add` で追加できます。');
  } else {
    lines.push(
      ...featured.map(
        (achievement) =>
          `${achievement.emoji} **${achievement.name}** · ${achievementRarityLabel(achievement.rarity)} · ${achievementPoints(achievement)}pt`,
      ),
    );
  }

  if (config.showRecentAchievements && config.recentAchievementCount > 0) {
    const recent = snapshot.achievements.unlocks
      .flatMap((record) => {
        const achievement = achievementById.get(record.achievementId);
        return achievement ? [{ achievement, unlockedAt: record.unlockedAt }] : [];
      })
      .slice(0, config.recentAchievementCount);
    lines.push('', '**🆕 Recent Achievements**');
    if (recent.length === 0) {
      lines.push('まだ解除したAchievementはありません。');
    } else {
      lines.push(
        ...recent.map(
          ({ achievement, unlockedAt }) =>
            `${achievement.emoji} **${achievement.name}** · <t:${Math.floor(unlockedAt.getTime() / 1000)}:R>`,
        ),
      );
    }
  }

  return lines.join('\n').slice(0, 1990);
}

async function executeProfileCommand(
  context: CommunityProfileContext,
  interaction: CommunityProfileInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await replyPrivate(interaction, 'このコマンドはDiscordサーバー内でのみ利用できます。');
    return;
  }
  const config = normalizeCommunityProfileConfig(context.config);
  if (!config.enabled) {
    await replyPrivate(interaction, 'Community Profile Pluginは現在無効です。');
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'view') {
    await executeView(context, interaction, config);
    return;
  }
  if (subcommand === 'compare') {
    await executeCompare(context, interaction, config);
    return;
  }
  if (subcommand === 'badge-add') {
    await executeBadgeAdd(context, interaction, config);
    return;
  }
  if (subcommand === 'badge-remove') {
    await executeBadgeRemove(context, interaction);
    return;
  }
  if (subcommand === 'badge-clear') {
    await clearFeaturedAchievements(context.prisma, interaction.guildId, interaction.user.id);
    await replyPrivate(interaction, '🏷️ Badge Showcaseをすべてクリアしました。');
    return;
  }
  if (subcommand === 'title-set') {
    const achievementId = normalizedAchievementId(
      interaction.options.getString('achievement', true),
    );
    const achievement = achievementId ? achievementById.get(achievementId) : undefined;
    if (!achievementId || !achievement) {
      await replyPrivate(interaction, 'そのAchievement IDは見つかりません。');
      return;
    }
    const result = await setCommunityProfileTitle(
      context.prisma,
      interaction.guildId,
      interaction.user.id,
      achievementId,
    );
    if (result.status === 'not-unlocked') {
      await replyPrivate(
        interaction,
        `🔒 **${achievement.name}** はまだ解除していないためTitleに設定できません。`,
      );
      return;
    }
    await replyPrivate(
      interaction,
      `${achievement.emoji} Profile Titleを **${achievement.name}** に変更しました。`,
    );
    return;
  }
  if (subcommand === 'title-clear') {
    await clearCommunityProfileTitle(context.prisma, interaction.guildId, interaction.user.id);
    await replyPrivate(interaction, '🏷️ Profile Titleを解除しました。');
    return;
  }
  if (subcommand === 'privacy') {
    const isPublic = interaction.options.getBoolean('public', true);
    if (isPublic === null) {
      await replyPrivate(interaction, '公開設定を指定してください。');
      return;
    }
    await setCommunityProfileVisibility(
      context.prisma,
      interaction.guildId,
      interaction.user.id,
      isPublic,
    );
    await replyPrivate(
      interaction,
      isPublic
        ? '🌐 Community Profileを公開しました。'
        : '🔒 Community Profileを非公開にしました。自分自身からは引き続き確認できます。',
    );
    return;
  }

  await replyPrivate(interaction, '不明なCommunity Profile操作です。');
}

async function executeView(
  context: CommunityProfileContext,
  interaction: CommunityProfileInteraction,
  config: CommunityProfileConfig,
): Promise<void> {
  const guildId = interaction.guildId!;
  const targetId = interaction.options.getUser('user')?.id ?? interaction.user.id;
  const snapshot = await getCommunityProfileSnapshotData(
    context.prisma,
    guildId,
    targetId,
    config.defaultActivityPeriod,
  );
  if (!canViewCommunityProfile(interaction.user.id, targetId, snapshot, config)) {
    await replyPrivate(
      interaction,
      snapshot.preference.isPublic
        ? 'このサーバーでは他メンバーのプロフィール閲覧が無効です。'
        : '🔒 このメンバーのCommunity Profileは非公開です。',
    );
    return;
  }
  const v3Data = await getCommunityProfileV3Data(context.prisma, guildId, targetId);
  await interaction.reply({
    content: formatCommunityProfile(snapshot, config, interaction.user.id, v3Data),
    flags: config.ephemeralResponses ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

async function executeCompare(
  context: CommunityProfileContext,
  interaction: CommunityProfileInteraction,
  config: CommunityProfileConfig,
): Promise<void> {
  if (!config.allowComparisons) {
    await replyPrivate(interaction, 'Community Profile Compareはこのサーバーで無効です。');
    return;
  }
  const guildId = interaction.guildId!;
  const targetId = interaction.options.getUser('user')?.id;
  if (!targetId) {
    await replyPrivate(interaction, '比較するメンバーを指定してください。');
    return;
  }
  if (targetId === interaction.user.id) {
    await replyPrivate(
      interaction,
      '自分自身との比較はできません。`/profile view` を利用してください。',
    );
    return;
  }

  const [viewerSnapshot, targetSnapshot] = await Promise.all([
    getCommunityProfileSnapshotData(
      context.prisma,
      guildId,
      interaction.user.id,
      config.defaultActivityPeriod,
    ),
    getCommunityProfileSnapshotData(
      context.prisma,
      guildId,
      targetId,
      config.defaultActivityPeriod,
    ),
  ]);

  if (!canViewCommunityProfile(interaction.user.id, targetId, targetSnapshot, config)) {
    await replyPrivate(
      interaction,
      targetSnapshot.preference.isPublic
        ? 'このサーバーでは他メンバーのプロフィール比較が無効です。'
        : '🔒 このメンバーのCommunity Profileは非公開のため比較できません。',
    );
    return;
  }

  const [viewerV3, targetV3] = await Promise.all([
    getCommunityProfileV3Data(context.prisma, guildId, interaction.user.id),
    getCommunityProfileV3Data(context.prisma, guildId, targetId),
  ]);
  await interaction.reply({
    content: formatCommunityProfileComparison(viewerSnapshot, viewerV3, targetSnapshot, targetV3, {
      showXp: config.showXp,
      showAchievements: config.showAchievements,
      showActivity: config.showActivity,
      showSeason: config.showSeason,
      showMinecraftActivity: config.showMinecraftActivity,
    }),
    flags: config.ephemeralResponses ? EPHEMERAL_FLAG : undefined,
    allowedMentions: { parse: [] },
  });
}

async function executeBadgeAdd(
  context: CommunityProfileContext,
  interaction: CommunityProfileInteraction,
  config: CommunityProfileConfig,
): Promise<void> {
  const guildId = interaction.guildId!;
  const achievementId = normalizedAchievementId(interaction.options.getString('achievement', true));
  if (!achievementId || !achievementById.has(achievementId)) {
    await replyPrivate(
      interaction,
      'そのAchievement IDは見つかりません。`/achievements` または `/achievement info` で確認してください。',
    );
    return;
  }
  const result = await addFeaturedAchievement(
    context.prisma,
    guildId,
    interaction.user.id,
    achievementId,
    config.featuredBadgeLimit,
  );
  const achievement = achievementById.get(achievementId)!;
  if (result.status === 'not-unlocked') {
    await replyPrivate(
      interaction,
      `🔒 **${achievement.name}** はまだ解除していないためShowcaseへ追加できません。`,
    );
    return;
  }
  if (result.status === 'already-featured') {
    await replyPrivate(
      interaction,
      `${achievement.emoji} **${achievement.name}** はすでに表示中です。`,
    );
    return;
  }
  if (result.status === 'limit-reached') {
    await replyPrivate(
      interaction,
      `Badge Showcaseは最大 **${config.featuredBadgeLimit}個**です。先に \`/profile badge-remove\` で外してください。`,
    );
    return;
  }
  await replyPrivate(
    interaction,
    `${achievement.emoji} **${achievement.name}** をBadge Showcaseへ追加しました。 (${result.featuredAchievementIds.length}/${config.featuredBadgeLimit})`,
  );
}

async function executeBadgeRemove(
  context: CommunityProfileContext,
  interaction: CommunityProfileInteraction,
): Promise<void> {
  const achievementId = normalizedAchievementId(interaction.options.getString('achievement', true));
  if (!achievementId) {
    await replyPrivate(interaction, 'Achievement IDを指定してください。');
    return;
  }
  const result = await removeFeaturedAchievement(
    context.prisma,
    interaction.guildId!,
    interaction.user.id,
    achievementId,
  );
  const achievement = achievementById.get(achievementId);
  if (result.status === 'not-featured') {
    await replyPrivate(interaction, 'そのAchievementはBadge Showcaseに設定されていません。');
    return;
  }
  await replyPrivate(
    interaction,
    `${achievement?.emoji ?? '🏷️'} **${achievement?.name ?? achievementId}** をBadge Showcaseから外しました。`,
  );
}

function appendXp(
  lines: string[],
  snapshot: CommunityProfileSnapshotData,
  config: CommunityProfileConfig,
): void {
  const xp = snapshot.xp.xp;
  const level = levelForXp(xp);
  const floor = xpRequiredForLevel(level);
  const next = xpRequiredForLevel(level + 1);
  const progress = Math.max(0, xp - floor);
  const needed = Math.max(1, next - floor);
  const percentage = Math.min(100, Math.floor((progress / needed) * 100));
  lines.push('', '**⚡ XP / Level**');
  lines.push(`Level **${level}** · **${xp.toLocaleString()} XP**`);
  lines.push(
    `次のLevelまで **${progress.toLocaleString()}/${needed.toLocaleString()} XP (${percentage}%)**`,
  );
  if (config.showRankings) {
    lines.push(
      `XP Rank **${formatRank(snapshot.xp.rank)}**${snapshot.xp.participants > 0 ? ` / ${snapshot.xp.participants.toLocaleString()}人` : ''}`,
    );
  }
}

function appendAchievements(
  lines: string[],
  snapshot: CommunityProfileSnapshotData,
  config: CommunityProfileConfig,
): void {
  const knownIds = snapshot.achievements.unlocks
    .map((record) => record.achievementId)
    .filter((id) => achievementById.has(id));
  const summary = summarizeAchievementCollection(knownIds);
  lines.push('', '**🏅 Achievements**');
  const completion = config.showAchievementCompletion ? ` · **${summary.percentage}%**` : '';
  lines.push(
    `**${summary.unlocked}/${summary.total}** unlocked${completion} · **${summary.score.toLocaleString()}pt**`,
  );
  if (config.showAchievementRarityBreakdown) {
    lines.push(
      summary.rarity
        .map((item) => `${achievementRarityLabel(item.rarity)} ${item.unlocked}/${item.total}`)
        .join(' · '),
    );
  }
  if (config.showRankings) {
    lines.push(
      `Badge Rank **${formatRank(snapshot.achievements.rank)}**${snapshot.achievements.participants > 0 ? ` / ${snapshot.achievements.participants.toLocaleString()}人` : ''}`,
    );
  }
}

function appendActivity(
  lines: string[],
  snapshot: CommunityProfileSnapshotData,
  config: CommunityProfileConfig,
): void {
  const activityLines: string[] = [];
  appendActivityMetric(
    activityLines,
    '💬 Messages',
    snapshot.activity.messages,
    config.showZeroActivity,
  );
  appendActivityMetric(
    activityLines,
    '✨ Reactions Given',
    snapshot.activity.reactionsGiven,
    config.showZeroActivity,
  );
  appendActivityMetric(
    activityLines,
    '💜 Reactions Received',
    snapshot.activity.reactionsReceived,
    config.showZeroActivity,
  );
  if (snapshot.activity.voiceSeconds > 0 || config.showZeroActivity) {
    activityLines.push(`🎙️ Voice **${formatDuration(snapshot.activity.voiceSeconds)}**`);
  }
  if (
    config.showMinecraftActivity &&
    (snapshot.activity.minecraftSeconds > 0 || config.showZeroActivity)
  ) {
    activityLines.push(`⛏️ Minecraft **${formatDuration(snapshot.activity.minecraftSeconds)}**`);
  }
  lines.push('', `**📊 Activity · ${periodLabel(snapshot.period)}**`);
  lines.push(
    ...(activityLines.length > 0 ? activityLines : ['まだ集計対象のActivityはありません。']),
  );
}

function resolveFeaturedAchievements(
  snapshot: CommunityProfileSnapshotData,
  limit: number,
): AchievementDefinition[] {
  const unlocked = new Set(snapshot.achievements.unlocks.map((record) => record.achievementId));
  return snapshot.preference.featuredAchievementIds
    .flatMap((id) => {
      const achievement = achievementById.get(id);
      return achievement && unlocked.has(id) ? [achievement] : [];
    })
    .slice(0, limit);
}

function resolveProfileTitle(
  snapshot: CommunityProfileSnapshotData,
): AchievementDefinition | undefined {
  const id = snapshot.preference.titleAchievementId;
  if (!id) return undefined;
  const unlocked = new Set(snapshot.achievements.unlocks.map((record) => record.achievementId));
  return unlocked.has(id) ? achievementById.get(id) : undefined;
}

function appendActivityMetric(
  lines: string[],
  label: string,
  value: number,
  showZero: boolean,
): void {
  if (value === 0 && !showZero) return;
  lines.push(`${label} **${value.toLocaleString()}**`);
}

function formatRank(rank: number | null): string {
  return rank === null ? '未ランク' : `#${rank.toLocaleString()}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function periodLabel(period: CommunityProfilePeriod): string {
  if (period === '7d') return '7 days';
  if (period === '30d') return '30 days';
  return 'All Time';
}

function readPeriod(value: unknown): CommunityProfilePeriod | undefined {
  return value === '7d' || value === '30d' || value === 'all' ? value : undefined;
}

function normalizedAchievementId(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

async function replyPrivate(
  interaction: CommunityProfileInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: EPHEMERAL_FLAG, allowedMentions: { parse: [] } });
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
