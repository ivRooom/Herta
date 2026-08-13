import {
  queryCommunityLeaderboardData,
  queryCommunityLeaderboardRank,
  type CommunityLeaderboardStorageMetric,
  type PrismaClient,
} from '@herta/db';
import {
  communityActivityPeriodStart,
  communityLeaderboardLevelForXp,
  communityLeaderboardPeriodLabel,
  communityTimestampPeriodStart,
  formatCommunityLeaderboardValue,
  getCommunityLeaderboardDefinition,
  getCommunitySeasonWindow,
  normalizeCommunityLeaderboardQuery,
  type CommunityLeaderboardMetric,
  type CommunityLeaderboardPeriod,
} from '@herta/shared';

export interface DiscordCommunityLeaderboardQuery {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardPeriod;
  limit: number;
}

export interface DiscordCommunityLeaderboardEntry {
  rank: number;
  userId: string;
  value: number;
  secondaryValue: number | null;
}

export interface DiscordCommunityLeaderboardSnapshot {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardPeriod;
  entries: DiscordCommunityLeaderboardEntry[];
  participants: number;
  seasonKey: string | null;
}

export interface DiscordCommunityRankSnapshot {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardPeriod;
  userId: string;
  rank: number | null;
  participants: number;
  value: number;
  secondaryValue: number | null;
  seasonKey: string | null;
}

export function resolveDiscordCommunityLeaderboardQuery(input: {
  metric?: string | null;
  period?: string | null;
  limit?: number | null;
  defaultLimit: number;
}): DiscordCommunityLeaderboardQuery {
  const normalized = normalizeCommunityLeaderboardQuery({
    metric: input.metric,
    period: input.period,
    limit: 10,
  });
  return {
    metric: normalized.metric,
    period: normalized.period,
    limit: clampLimit(input.limit ?? input.defaultLimit),
  };
}

export async function getDiscordCommunityLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  query: DiscordCommunityLeaderboardQuery,
  now = new Date(),
): Promise<DiscordCommunityLeaderboardSnapshot> {
  const seasonKey = query.metric === 'season' ? getCommunitySeasonWindow(now).key : null;
  const start = resolveStart(query.metric, query.period, now);
  const data = await queryCommunityLeaderboardData(prisma, {
    guildId,
    metric: storageMetricFor(query.metric),
    limit: query.limit,
    ...(start ? { start } : {}),
    ...(seasonKey ? { seasonKey } : {}),
  });

  return {
    metric: query.metric,
    period: normalizedPeriod(query.metric, query.period),
    participants: data.participants,
    seasonKey,
    entries: data.entries.map((entry) => transformEntry(query.metric, entry)),
  };
}

export async function getDiscordCommunityRank(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  query: Pick<DiscordCommunityLeaderboardQuery, 'metric' | 'period'>,
  now = new Date(),
): Promise<DiscordCommunityRankSnapshot> {
  const seasonKey = query.metric === 'season' ? getCommunitySeasonWindow(now).key : null;
  const start = resolveStart(query.metric, query.period, now);
  const data = await queryCommunityLeaderboardRank(prisma, {
    guildId,
    userId,
    metric: storageMetricFor(query.metric),
    ...(start ? { start } : {}),
    ...(seasonKey ? { seasonKey } : {}),
  });

  if (!data) {
    return {
      metric: query.metric,
      period: normalizedPeriod(query.metric, query.period),
      userId,
      rank: null,
      participants: 0,
      value: 0,
      secondaryValue: query.metric === 'level' ? 0 : null,
      seasonKey,
    };
  }

  const transformed = transformEntry(query.metric, data);
  return {
    metric: query.metric,
    period: normalizedPeriod(query.metric, query.period),
    userId,
    rank: data.rank,
    participants: data.participants,
    value: transformed.value,
    secondaryValue: transformed.secondaryValue,
    seasonKey,
  };
}

export function formatDiscordCommunityLeaderboard(
  snapshot: DiscordCommunityLeaderboardSnapshot,
): string {
  const definition = getCommunityLeaderboardDefinition(snapshot.metric);
  const header = `**🏆 ${definition.label} Leaderboard · ${communityLeaderboardPeriodLabel(snapshot.period)}**`;
  if (snapshot.entries.length === 0) {
    return [header, 'まだランキングデータがありません。'].join('\n');
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = snapshot.entries.map((entry) => {
    const prefix = medals[entry.rank - 1] ?? `${entry.rank}.`;
    return `${prefix} <@${entry.userId}> — ${formatCommunityLeaderboardValue(
      snapshot.metric,
      entry.value,
      entry.secondaryValue,
    )}`;
  });
  return [header, `参加: **${snapshot.participants.toLocaleString()}人**`, ...lines].join('\n');
}

export function formatDiscordCommunityRank(snapshot: DiscordCommunityRankSnapshot): string {
  const definition = getCommunityLeaderboardDefinition(snapshot.metric);
  const rankLabel = snapshot.rank
    ? `**#${snapshot.rank.toLocaleString()} / ${snapshot.participants.toLocaleString()}**`
    : '**未ランク**';
  return [
    `**<@${snapshot.userId}> の ${definition.label} Rank · ${communityLeaderboardPeriodLabel(snapshot.period)}**`,
    `順位: ${rankLabel}`,
    `${definition.shortLabel}: **${formatCommunityLeaderboardValue(
      snapshot.metric,
      snapshot.value,
      snapshot.secondaryValue,
    )}**`,
  ].join('\n');
}

function transformEntry(
  metric: CommunityLeaderboardMetric,
  entry: { rank: number; userId: string; value: number },
): DiscordCommunityLeaderboardEntry {
  if (metric === 'level') {
    return {
      rank: entry.rank,
      userId: entry.userId,
      value: communityLeaderboardLevelForXp(entry.value),
      secondaryValue: entry.value,
    };
  }
  return { ...entry, secondaryValue: null };
}

function storageMetricFor(metric: CommunityLeaderboardMetric): CommunityLeaderboardStorageMetric {
  return metric === 'level' ? 'xp' : metric;
}

function resolveStart(
  metric: CommunityLeaderboardMetric,
  period: CommunityLeaderboardPeriod,
  now: Date,
): Date | undefined {
  if (metric === 'xp' || metric === 'level' || metric === 'season') return undefined;
  if (metric === 'achievements') return communityTimestampPeriodStart(period, now);
  return communityActivityPeriodStart(period, now);
}

function normalizedPeriod(
  metric: CommunityLeaderboardMetric,
  period: CommunityLeaderboardPeriod,
): CommunityLeaderboardPeriod {
  if (metric === 'xp' || metric === 'level') return 'all';
  if (metric === 'season') return 'season';
  return period;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(5, Math.min(25, Math.trunc(value)));
}
