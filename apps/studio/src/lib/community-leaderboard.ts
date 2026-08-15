import {
  getCommunitySeasonSnapshotMetadata,
  listCommunitySeasonSnapshotAwards,
  queryCommunityLeaderboardData,
  queryCommunityLeaderboardRank,
  type CommunityLeaderboardStorageMetric,
  type CommunitySeasonSnapshotAward,
  type CommunitySeasonSnapshotMetadata,
} from '@herta/db';
import {
  communityActivityPeriodStart,
  communityLeaderboardLevelForXp,
  communityTimestampPeriodStart,
  getCommunitySeasonWindow,
  type CommunityLeaderboardMetric,
  type CommunityLeaderboardQuery,
} from '@herta/shared';
import { prisma } from '@/lib/db';

export interface CommunityLeaderboardEntry {
  rank: number;
  userId: string;
  value: number;
  secondaryValue: number | null;
}

export interface CommunityLeaderboardSnapshot {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardQuery['period'];
  entries: CommunityLeaderboardEntry[];
  participants: number;
  seasonKey: string | null;
  viewerRank: CommunityLeaderboardEntry | null;
  seasonSnapshot: CommunitySeasonSnapshotMetadata | null;
  seasonAwards: CommunitySeasonSnapshotAward[];
}

export async function getCommunityLeaderboardSnapshot(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now = new Date(),
  options: { seasonKey?: string | null; viewerUserId?: string | null } = {},
): Promise<CommunityLeaderboardSnapshot> {
  const storageMetric = storageMetricFor(query.metric);
  const requestedSeasonKey = options.seasonKey?.trim();
  const seasonKey =
    query.metric === 'season' ? requestedSeasonKey || getCommunitySeasonWindow(now).key : null;
  const start = resolveStart(query, now);
  const storageQuery = {
    guildId,
    metric: storageMetric,
    ...(start ? { start } : {}),
    ...(seasonKey ? { seasonKey } : {}),
  };

  const [data, viewerRank, seasonSnapshot, seasonAwards] = await Promise.all([
    queryCommunityLeaderboardData(prisma, { ...storageQuery, limit: query.limit }),
    options.viewerUserId
      ? queryCommunityLeaderboardRank(prisma, {
          ...storageQuery,
          userId: options.viewerUserId,
        })
      : Promise.resolve(null),
    seasonKey ? getCommunitySeasonSnapshotMetadata(prisma, guildId, seasonKey) : Promise.resolve(null),
    seasonKey ? listCommunitySeasonSnapshotAwards(prisma, guildId, seasonKey) : Promise.resolve([]),
  ]);

  return {
    metric: query.metric,
    period:
      query.metric === 'xp' || query.metric === 'level'
        ? 'all'
        : query.metric === 'season'
          ? 'season'
          : query.period,
    participants: data.participants,
    seasonKey,
    viewerRank: viewerRank ? mapLeaderboardEntry(query.metric, viewerRank) : null,
    entries: data.entries.map((entry) => mapLeaderboardEntry(query.metric, entry)),
    seasonSnapshot,
    seasonAwards,
  };
}

function mapLeaderboardEntry(
  metric: CommunityLeaderboardMetric,
  entry: { rank: number; userId: string; value: number },
): CommunityLeaderboardEntry {
  return {
    rank: entry.rank,
    userId: entry.userId,
    value: metric === 'level' ? communityLeaderboardLevelForXp(entry.value) : entry.value,
    secondaryValue: metric === 'level' ? entry.value : null,
  };
}

function storageMetricFor(metric: CommunityLeaderboardMetric): CommunityLeaderboardStorageMetric {
  return metric === 'level' ? 'xp' : metric;
}

function resolveStart(query: CommunityLeaderboardQuery, now: Date): Date | undefined {
  if (query.metric === 'xp' || query.metric === 'level' || query.metric === 'season') {
    return undefined;
  }
  if (query.metric === 'achievements') {
    return communityTimestampPeriodStart(query.period, now);
  }
  return communityActivityPeriodStart(query.period, now);
}
