import { getCommunitySeasonWindow } from '@herta/shared';
import { prisma } from '@/lib/db';
import {
  communityActivityPeriodStart,
  communityLeaderboardLevelForXp,
  communityTimestampPeriodStart,
  type CommunityLeaderboardMetric,
  type CommunityLeaderboardQuery,
} from './community-leaderboard-core';

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

interface RankedRow {
  userId: string;
  total: bigint;
  participants: bigint;
}

interface XpRankedRow {
  userId: string;
  xp: bigint;
  participants: bigint;
}

type SingleActivityMetric = 'messages' | 'voice' | 'minecraft';

export async function getCommunityLeaderboardSnapshot(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now = new Date(),
): Promise<CommunityLeaderboardSnapshot> {
  if (query.metric === 'xp' || query.metric === 'level') {
    return getXpLeaderboard(guildId, query);
  }
  if (query.metric === 'achievements') {
    return getAchievementLeaderboard(guildId, query, now);
  }
  if (query.metric === 'season') {
    return getSeasonLeaderboard(guildId, query, now);
  }
  return getActivityLeaderboard(guildId, query, now);
}

async function getXpLeaderboard(
  guildId: string,
  query: CommunityLeaderboardQuery,
): Promise<CommunityLeaderboardSnapshot> {
  const rows = await prisma.$queryRaw<XpRankedRow[]>`
    WITH ranked AS (
      SELECT
        "user_id" AS "userId",
        "xp"::bigint AS "xp",
        COUNT(*) OVER()::bigint AS "participants"
      FROM "xp_profiles"
      WHERE "guild_id" = ${guildId}
      ORDER BY "xp" DESC, "updated_at" ASC, "user_id" ASC
      LIMIT ${query.limit}
    )
    SELECT "userId", "xp", "participants" FROM ranked
  `;

  return {
    metric: query.metric,
    period: 'all',
    participants: Number(rows[0]?.participants ?? 0n),
    seasonKey: null,
    entries: rows.map((row, index) => {
      const xp = Number(row.xp);
      return {
        rank: index + 1,
        userId: row.userId,
        value: query.metric === 'level' ? communityLeaderboardLevelForXp(xp) : xp,
        secondaryValue: query.metric === 'level' ? xp : null,
      };
    }),
  };
}

async function getActivityLeaderboard(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now: Date,
): Promise<CommunityLeaderboardSnapshot> {
  const start = communityActivityPeriodStart(query.period, now);
  let rows: RankedRow[];

  if (query.metric === 'reactions') {
    rows = await prisma.$queryRaw<RankedRow[]>`
      WITH totals AS (
        SELECT "user_id", SUM("value")::bigint AS "total"
        FROM "community_activity_daily"
        WHERE "guild_id" = ${guildId}
          AND "metric" IN ('reactions_given', 'reactions_received')
          AND "activity_date" >= ${start}
        GROUP BY "user_id"
      )
      SELECT
        "user_id" AS "userId",
        "total",
        COUNT(*) OVER()::bigint AS "participants"
      FROM totals
      ORDER BY "total" DESC, "user_id" ASC
      LIMIT ${query.limit}
    `;
  } else {
    if (!isSingleActivityMetric(query.metric)) {
      throw new Error(`Unsupported activity leaderboard metric: ${query.metric}`);
    }
    rows = await getSingleActivityMetricLeaderboard(guildId, query.metric, start, query.limit);
  }

  return {
    metric: query.metric,
    period: query.period,
    participants: Number(rows[0]?.participants ?? 0n),
    seasonKey: null,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      value: Number(row.total),
      secondaryValue: null,
    })),
  };
}

async function getSingleActivityMetricLeaderboard(
  guildId: string,
  metric: SingleActivityMetric,
  start: Date,
  limit: number,
): Promise<RankedRow[]> {
  const databaseMetric =
    metric === 'messages' ? 'messages' : metric === 'voice' ? 'voice_seconds' : 'minecraft_seconds';

  return prisma.$queryRaw<RankedRow[]>`
    WITH totals AS (
      SELECT "user_id", SUM("value")::bigint AS "total"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${guildId}
        AND "metric" = ${databaseMetric}
        AND "activity_date" >= ${start}
      GROUP BY "user_id"
    )
    SELECT
      "user_id" AS "userId",
      "total",
      COUNT(*) OVER()::bigint AS "participants"
    FROM totals
    ORDER BY "total" DESC, "user_id" ASC
    LIMIT ${limit}
  `;
}

async function getAchievementLeaderboard(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now: Date,
): Promise<CommunityLeaderboardSnapshot> {
  const start = communityTimestampPeriodStart(query.period, now);
  const rows = await prisma.$queryRaw<RankedRow[]>`
    WITH totals AS (
      SELECT "user_id", COUNT(*)::bigint AS "total"
      FROM "achievement_unlocks"
      WHERE "guild_id" = ${guildId}
        AND "unlocked_at" >= ${start}
        AND "achievement_id" NOT LIKE 'blocked:%'
      GROUP BY "user_id"
    )
    SELECT
      "user_id" AS "userId",
      "total",
      COUNT(*) OVER()::bigint AS "participants"
    FROM totals
    ORDER BY "total" DESC, "user_id" ASC
    LIMIT ${query.limit}
  `;

  return {
    metric: query.metric,
    period: query.period,
    participants: Number(rows[0]?.participants ?? 0n),
    seasonKey: null,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      value: Number(row.total),
      secondaryValue: null,
    })),
  };
}

async function getSeasonLeaderboard(
  guildId: string,
  query: CommunityLeaderboardQuery,
  now: Date,
): Promise<CommunityLeaderboardSnapshot> {
  const seasonKey = getCommunitySeasonWindow(now).key;
  const rows = await prisma.$queryRaw<RankedRow[]>`
    WITH totals AS (
      SELECT "user_id", SUM("points")::bigint AS "total"
      FROM "community_challenge_completions"
      WHERE "guild_id" = ${guildId} AND "season_key" = ${seasonKey}
      GROUP BY "user_id"
    )
    SELECT
      "user_id" AS "userId",
      "total",
      COUNT(*) OVER()::bigint AS "participants"
    FROM totals
    ORDER BY "total" DESC, "user_id" ASC
    LIMIT ${query.limit}
  `;

  return {
    metric: query.metric,
    period: 'season',
    participants: Number(rows[0]?.participants ?? 0n),
    seasonKey,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      value: Number(row.total),
      secondaryValue: null,
    })),
  };
}

function isSingleActivityMetric(
  metric: CommunityLeaderboardMetric,
): metric is SingleActivityMetric {
  return metric === 'messages' || metric === 'voice' || metric === 'minecraft';
}
