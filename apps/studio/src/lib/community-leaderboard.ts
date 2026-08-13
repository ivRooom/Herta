import {
  queryCommunityLeaderboardData,
  type CommunityLeaderboardStorageMetric,
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
}

export async function getCommunityLeaderboardSnapshot(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now = new Date(),
): Promise<CommunityLeaderboardSnapshot> {
  const storageMetric = storageMetricFor(query.metric);
  const seasonKey = query.metric === 'season' ? getCommunitySeasonWindow(now).key : null;
  const start = resolveStart(query, now);
  const data = await queryCommunityLeaderboardData(prisma, {
    guildId,
    metric: storageMetric,
    limit: query.limit,
    ...(start ? { start } : {}),
    ...(seasonKey ? { seasonKey } : {}),
  });

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
    entries: data.entries.map((entry) => ({
      rank: entry.rank,
      userId: entry.userId,
      value:
        query.metric === 'level' ? communityLeaderboardLevelForXp(entry.value) : entry.value,
      secondaryValue: query.metric === 'level' ? entry.value : null,
    })),
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
