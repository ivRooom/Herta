import type { CommunityProfileSnapshotData, PrismaClient } from '@herta/db';
import {
  ACHIEVEMENTS,
  communitySeasonLevelProgress,
  getCommunityChallengeWindow,
  getCommunitySeasonWindow,
  summarizeAchievementCollection,
  type AchievementDefinition,
  type AchievementMetric,
} from '@herta/shared';
import { getAchievementMetrics, type AchievementMetrics } from './achievements-repository.js';
import {
  getCommunityDailyClearStreak,
  getCommunitySeasonSummary,
  type CommunitySeasonSummary,
} from './community-challenge-repository.js';
import { levelForXp } from './xp-level.js';

export interface CommunityProfileMomentumValue {
  current: number;
  previous: number;
}

export interface CommunityProfileMomentum {
  messages: CommunityProfileMomentumValue;
  reactionsGiven: CommunityProfileMomentumValue;
  reactionsReceived: CommunityProfileMomentumValue;
  voiceSeconds: CommunityProfileMomentumValue;
  minecraftSeconds: CommunityProfileMomentumValue;
}

export interface CommunityProfileV3Data {
  seasonKey: string;
  seasonIndex: number;
  seasonEndsAt: Date;
  season: CommunitySeasonSummary;
  seasonLevelPoints: number;
  dailyClearStreak: number;
  metrics: AchievementMetrics;
  momentum: CommunityProfileMomentum;
}

interface MomentumRow {
  metric: string;
  current: bigint;
  previous: bigint;
}

interface SeasonLevelPointsRow {
  seasonLevelPoints: number;
}

export async function getCommunityProfileV3Data(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<CommunityProfileV3Data> {
  const seasonWindow = getCommunitySeasonWindow(now);
  const todayWindow = getCommunityChallengeWindow('daily', now);
  const [season, dailyClearStreak, metrics, momentum, seasonLevelPoints] = await Promise.all([
    getCommunitySeasonSummary(prisma, guildId, userId, seasonWindow.key),
    getCommunityDailyClearStreak(prisma, guildId, userId, todayWindow.key),
    getAchievementMetrics(prisma, guildId, userId, now),
    getCommunityProfileMomentum(prisma, guildId, userId, now),
    getCommunityProfileSeasonLevelPoints(prisma, guildId),
  ]);

  return {
    seasonKey: seasonWindow.key,
    seasonIndex: seasonWindow.index,
    seasonEndsAt: seasonWindow.endsAt,
    season,
    seasonLevelPoints,
    dailyClearStreak,
    metrics,
    momentum,
  };
}

export async function getCommunityProfileMomentum(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<CommunityProfileMomentum> {
  const today = getCommunityChallengeWindow('daily', now);
  const currentStart = shiftDateKey(today.key, -6);
  const previousStart = shiftDateKey(today.key, -13);
  const endExclusive = today.endDateKey;
  const rows = await prisma.$queryRaw<MomentumRow[]>`
    SELECT
      "metric",
      COALESCE(
        SUM("value") FILTER (WHERE "activity_date" >= ${currentStart}::date),
        0
      )::bigint AS "current",
      COALESCE(
        SUM("value") FILTER (
          WHERE "activity_date" >= ${previousStart}::date
            AND "activity_date" < ${currentStart}::date
        ),
        0
      )::bigint AS "previous"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "activity_date" >= ${previousStart}::date
      AND "activity_date" < ${endExclusive}::date
      AND "metric" IN (
        'messages', 'reactions_given', 'reactions_received', 'voice_seconds', 'minecraft_seconds'
      )
    GROUP BY "metric"
  `;

  const byMetric = new Map(rows.map((row) => [row.metric, row]));
  return {
    messages: momentumValue(byMetric.get('messages')),
    reactionsGiven: momentumValue(byMetric.get('reactions_given')),
    reactionsReceived: momentumValue(byMetric.get('reactions_received')),
    voiceSeconds: momentumValue(byMetric.get('voice_seconds')),
    minecraftSeconds: momentumValue(byMetric.get('minecraft_seconds')),
  };
}

export async function getCommunityProfileSeasonLevelPoints(
  prisma: PrismaClient,
  guildId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<SeasonLevelPointsRow[]>`
    SELECT
      CASE
        WHEN jsonb_typeof("config"->'seasonLevelPoints') = 'number'
          THEN ROUND(("config"->>'seasonLevelPoints')::numeric)::int
        ELSE 100
      END AS "seasonLevelPoints"
    FROM "guild_plugins"
    WHERE "guild_id" = ${guildId}
      AND "plugin_id" = 'community-challenge'
      AND "enabled" = TRUE
    LIMIT 1
  `;
  return clamp(rows[0]?.seasonLevelPoints ?? 100, 25, 500);
}

export function appendCommunityProfileSeason(
  lines: string[],
  data: CommunityProfileV3Data,
  options: { showRankings: boolean; showProgress: boolean; showDailyStreak: boolean },
): void {
  const progress = communitySeasonLevelProgress(data.season.points, data.seasonLevelPoints);
  lines.push('', `**🌟 Current Season · Season ${data.seasonIndex}**`);
  lines.push(
    `Level **${progress.level}** · **${data.season.points.toLocaleString()}pt** · Challenge Clear **${data.season.completionCount.toLocaleString()}回**`,
  );
  if (options.showProgress) {
    lines.push(
      `次のSeason Levelまで **${progress.current.toLocaleString()}/${progress.needed.toLocaleString()}pt (${progress.percentage}%)**`,
    );
  }
  if (options.showRankings) {
    lines.push(
      `Season Rank **${formatRank(data.season.rank)}**${data.season.participants > 0 ? ` / ${data.season.participants.toLocaleString()}人` : ''}`,
    );
  }
  if (options.showDailyStreak) {
    lines.push(`🔥 Daily ALL CLEAR Streak **${data.dailyClearStreak.toLocaleString()}日**`);
  }
  lines.push(`Season終了 <t:${Math.floor(data.seasonEndsAt.getTime() / 1000)}:R>`);
}

export function appendCommunityProfileMilestones(
  lines: string[],
  snapshot: CommunityProfileSnapshotData,
  data: CommunityProfileV3Data,
  limit: number,
): void {
  const milestones = getNextAchievementMilestones(snapshot, data.metrics, limit);
  lines.push('', '**🎯 Next Milestones**');
  if (milestones.length === 0) {
    lines.push('表示できる次のAchievementはありません。');
    return;
  }
  for (const milestone of milestones) {
    lines.push(
      `${milestone.achievement.emoji} **${milestone.achievement.name}** · **${milestone.percentage}%** · ${formatAchievementMetricValue(milestone.achievement.metric!, milestone.current)}/${formatAchievementMetricValue(milestone.achievement.metric!, milestone.target)}`,
    );
  }
}

export function appendCommunityProfileMomentum(
  lines: string[],
  momentum: CommunityProfileMomentum,
  showMinecraft: boolean,
): void {
  const entries: Array<{
    emoji: string;
    label: string;
    metric: keyof CommunityProfileMomentum;
    kind: 'count' | 'duration';
  }> = [
    { emoji: '💬', label: 'Messages', metric: 'messages', kind: 'count' },
    { emoji: '✨', label: 'Reactions Given', metric: 'reactionsGiven', kind: 'count' },
    {
      emoji: '💜',
      label: 'Reactions Received',
      metric: 'reactionsReceived',
      kind: 'count',
    },
    { emoji: '🎙️', label: 'Voice', metric: 'voiceSeconds', kind: 'duration' },
  ];
  if (showMinecraft) {
    entries.push({ emoji: '⛏️', label: 'Minecraft', metric: 'minecraftSeconds', kind: 'duration' });
  }

  lines.push('', '**📈 7-day Momentum**');
  for (const entry of entries) {
    const value = momentum[entry.metric];
    const current =
      entry.kind === 'duration' ? formatDuration(value.current) : value.current.toLocaleString();
    lines.push(`${entry.emoji} ${entry.label} **${current}** · ${formatMomentumTrend(value)}`);
  }
}

export function formatCommunityProfileComparison(
  leftSnapshot: CommunityProfileSnapshotData,
  leftData: CommunityProfileV3Data,
  rightSnapshot: CommunityProfileSnapshotData,
  rightData: CommunityProfileV3Data,
  options: {
    showXp: boolean;
    showAchievements: boolean;
    showActivity: boolean;
    showSeason: boolean;
    showMinecraftActivity: boolean;
  },
): string {
  const lines = [
    '**⚖️ Community Profile Compare**',
    `<@${leftSnapshot.userId}> **vs** <@${rightSnapshot.userId}>`,
  ];

  if (options.showXp) {
    lines.push(
      '',
      '**⚡ XP / Level**',
      `Level **${levelForXp(leftSnapshot.xp.xp)}** / **${levelForXp(rightSnapshot.xp.xp)}**`,
      `XP **${leftSnapshot.xp.xp.toLocaleString()}** / **${rightSnapshot.xp.xp.toLocaleString()}**`,
      `Rank **${formatRank(leftSnapshot.xp.rank)}** / **${formatRank(rightSnapshot.xp.rank)}**`,
    );
  }

  if (options.showAchievements) {
    const leftAchievements = summarizeAchievementCollection(
      leftSnapshot.achievements.unlocks.map((record) => record.achievementId),
    );
    const rightAchievements = summarizeAchievementCollection(
      rightSnapshot.achievements.unlocks.map((record) => record.achievementId),
    );
    lines.push(
      '',
      '**🏅 Achievements**',
      `Unlocked **${leftAchievements.unlocked}/${leftAchievements.total}** / **${rightAchievements.unlocked}/${rightAchievements.total}**`,
      `Badge Point **${leftAchievements.score.toLocaleString()}pt** / **${rightAchievements.score.toLocaleString()}pt**`,
    );
  }

  if (options.showSeason) {
    const leftSeason = communitySeasonLevelProgress(
      leftData.season.points,
      leftData.seasonLevelPoints,
    );
    const rightSeason = communitySeasonLevelProgress(
      rightData.season.points,
      rightData.seasonLevelPoints,
    );
    lines.push(
      '',
      `**🌟 Current Season · Season ${leftData.seasonIndex}**`,
      `Season Level **${leftSeason.level}** / **${rightSeason.level}**`,
      `Point **${leftData.season.points.toLocaleString()}pt** / **${rightData.season.points.toLocaleString()}pt**`,
      `Rank **${formatRank(leftData.season.rank)}** / **${formatRank(rightData.season.rank)}**`,
      `Challenge Clear **${leftData.season.completionCount.toLocaleString()}回** / **${rightData.season.completionCount.toLocaleString()}回**`,
      `🔥 Daily Streak **${leftData.dailyClearStreak.toLocaleString()}日** / **${rightData.dailyClearStreak.toLocaleString()}日**`,
    );
  }

  if (options.showActivity) {
    lines.push('', `**📊 Activity · ${periodLabel(leftSnapshot.period)}**`);
    lines.push(
      `💬 Messages **${leftSnapshot.activity.messages.toLocaleString()}** / **${rightSnapshot.activity.messages.toLocaleString()}**`,
      `✨ Reactions Given **${leftSnapshot.activity.reactionsGiven.toLocaleString()}** / **${rightSnapshot.activity.reactionsGiven.toLocaleString()}**`,
      `💜 Reactions Received **${leftSnapshot.activity.reactionsReceived.toLocaleString()}** / **${rightSnapshot.activity.reactionsReceived.toLocaleString()}**`,
      `🎙️ Voice **${formatDuration(leftSnapshot.activity.voiceSeconds)}** / **${formatDuration(rightSnapshot.activity.voiceSeconds)}**`,
    );
    if (options.showMinecraftActivity) {
      lines.push(
        `⛏️ Minecraft **${formatDuration(leftSnapshot.activity.minecraftSeconds)}** / **${formatDuration(rightSnapshot.activity.minecraftSeconds)}**`,
      );
    }
  }

  return lines.join('\n').slice(0, 1990);
}

export interface AchievementMilestone {
  achievement: AchievementDefinition;
  current: number;
  target: number;
  percentage: number;
}

export function getNextAchievementMilestones(
  snapshot: CommunityProfileSnapshotData,
  metrics: AchievementMetrics,
  limit: number,
): AchievementMilestone[] {
  const unlocked = new Set(snapshot.achievements.unlocks.map((record) => record.achievementId));
  return ACHIEVEMENTS.flatMap((achievement) => {
    if (
      unlocked.has(achievement.id) ||
      achievement.secret ||
      !achievement.metric ||
      achievement.target === undefined ||
      achievement.target <= 0
    ) {
      return [];
    }
    const current = Math.max(0, Number(metrics[achievement.metric] ?? 0));
    const target = achievement.target;
    const percentage = Math.min(100, Math.floor((current / target) * 100));
    return [{ achievement, current: Math.min(current, target), target, percentage }];
  })
    .sort((left, right) => {
      if (left.percentage !== right.percentage) return right.percentage - left.percentage;
      const leftRemaining = left.target - left.current;
      const rightRemaining = right.target - right.current;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      return left.achievement.id.localeCompare(right.achievement.id);
    })
    .slice(0, clamp(Math.trunc(limit), 1, 5));
}

export function formatMomentumTrend(value: CommunityProfileMomentumValue): string {
  if (value.previous === 0 && value.current === 0) return '→ 0%';
  if (value.previous === 0) return '🆕 new';
  const percentage = Math.round(((value.current - value.previous) / value.previous) * 100);
  if (percentage === 0) return '→ 0%';
  if (percentage > 0) return `↑ ${Math.min(999, percentage)}${percentage > 999 ? '%+' : '%'}`;
  return `↓ ${Math.min(999, Math.abs(percentage))}${Math.abs(percentage) > 999 ? '%+' : '%'}`;
}

function momentumValue(row: MomentumRow | undefined): CommunityProfileMomentumValue {
  return {
    current: Number(row?.current ?? 0n),
    previous: Number(row?.previous ?? 0n),
  };
}

function formatAchievementMetricValue(metric: AchievementMetric, value: number): string {
  if (metric === 'voiceSeconds' || metric === 'minecraftSeconds') return formatDuration(value);
  if (metric === 'seasonPoints') return `${Math.floor(value).toLocaleString()}pt`;
  if (
    metric === 'pollVotes' ||
    metric === 'giveawayEntries' ||
    metric === 'eventGoing' ||
    metric === 'suggestions' ||
    metric === 'acceptedSuggestions' ||
    metric === 'challengeCompletions'
  ) {
    return `${Math.floor(value).toLocaleString()}回`;
  }
  if (metric === 'xp') return `${Math.floor(value).toLocaleString()} XP`;
  return Math.floor(value).toLocaleString();
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatRank(rank: number | null): string {
  return rank === null ? '—' : `#${rank.toLocaleString()}`;
}

function periodLabel(period: CommunityProfileSnapshotData['period']): string {
  if (period === '7d') return '7 days';
  if (period === '30d') return '30 days';
  return 'All time';
}

function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
