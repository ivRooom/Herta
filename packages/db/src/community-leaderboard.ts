import type { PrismaClient } from '@prisma/client';

export type CommunityLeaderboardStorageMetric =
  | 'xp'
  | 'messages'
  | 'reactions'
  | 'voice'
  | 'minecraft'
  | 'achievements'
  | 'season';

export interface CommunityLeaderboardDataEntry {
  rank: number;
  userId: string;
  value: number;
}

export interface CommunityLeaderboardDataSnapshot {
  entries: CommunityLeaderboardDataEntry[];
  participants: number;
}

export interface CommunityLeaderboardRankData {
  rank: number;
  userId: string;
  value: number;
  participants: number;
}

interface RankedRow {
  userId: string;
  total: bigint;
  participants: bigint;
}

interface RankRow extends RankedRow {
  rank: bigint;
}

export async function queryCommunityLeaderboardData(
  prisma: PrismaClient,
  input: {
    guildId: string;
    metric: CommunityLeaderboardStorageMetric;
    limit: number;
    start?: Date;
    seasonKey?: string;
  },
): Promise<CommunityLeaderboardDataSnapshot> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit)));
  const rows = await listRows(prisma, { ...input, limit });
  return {
    participants: Number(rows[0]?.participants ?? 0n),
    entries: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      value: Number(row.total),
    })),
  };
}

export async function queryCommunityLeaderboardRank(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    metric: CommunityLeaderboardStorageMetric;
    start?: Date;
    seasonKey?: string;
  },
): Promise<CommunityLeaderboardRankData | null> {
  const rows = await rankRows(prisma, input);
  const row = rows[0];
  if (!row) return null;
  return {
    rank: Number(row.rank),
    userId: row.userId,
    value: Number(row.total),
    participants: Number(row.participants),
  };
}

async function listRows(
  prisma: PrismaClient,
  input: {
    guildId: string;
    metric: CommunityLeaderboardStorageMetric;
    limit: number;
    start?: Date;
    seasonKey?: string;
  },
): Promise<RankedRow[]> {
  if (input.metric === 'xp') {
    return prisma.$queryRaw<RankedRow[]>`
      WITH totals AS (
        SELECT "user_id", "xp"::bigint AS "total", "updated_at"
        FROM "xp_profiles"
        WHERE "guild_id" = ${input.guildId}
      )
      SELECT
        "user_id" AS "userId",
        "total",
        COUNT(*) OVER()::bigint AS "participants"
      FROM totals
      ORDER BY "total" DESC, "updated_at" ASC, "user_id" ASC
      LIMIT ${input.limit}
    `;
  }

  if (input.metric === 'achievements') {
    const start = input.start ?? new Date('1970-01-01T00:00:00.000Z');
    return prisma.$queryRaw<RankedRow[]>`
      WITH totals AS (
        SELECT "user_id", COUNT(*)::bigint AS "total"
        FROM "achievement_unlocks"
        WHERE "guild_id" = ${input.guildId}
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
      LIMIT ${input.limit}
    `;
  }

  if (input.metric === 'season') {
    const seasonKey = requireSeasonKey(input.seasonKey);
    return prisma.$queryRaw<RankedRow[]>`
      WITH snapshot_meta AS (
        SELECT "participant_count"
        FROM "community_season_snapshots"
        WHERE "guild_id" = ${input.guildId} AND "season_key" = ${seasonKey}
        LIMIT 1
      ), snapshot_rows AS (
        SELECT
          e."user_id",
          e."points"::bigint AS "total",
          e."rank"::bigint AS "sort_rank",
          s."participant_count"::bigint AS "participants"
        FROM "community_season_snapshot_entries" e
        JOIN "community_season_snapshots" s
          ON s."guild_id" = e."guild_id" AND s."season_key" = e."season_key"
        WHERE e."guild_id" = ${input.guildId} AND e."season_key" = ${seasonKey}
      ), live_totals AS (
        SELECT "user_id", SUM("points")::bigint AS "total"
        FROM "community_challenge_completions"
        WHERE "guild_id" = ${input.guildId} AND "season_key" = ${seasonKey}
        GROUP BY "user_id"
      ), live_ranked AS (
        SELECT
          "user_id",
          "total",
          ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::bigint AS "sort_rank",
          COUNT(*) OVER()::bigint AS "participants"
        FROM live_totals
      ), selected_rows AS (
        SELECT "user_id", "total", "sort_rank", "participants"
        FROM snapshot_rows
        UNION ALL
        SELECT "user_id", "total", "sort_rank", "participants"
        FROM live_ranked
        WHERE NOT EXISTS (SELECT 1 FROM snapshot_meta)
      )
      SELECT "user_id" AS "userId", "total", "participants"
      FROM selected_rows
      ORDER BY "sort_rank" ASC
      LIMIT ${input.limit}
    `;
  }

  const start = input.start ?? new Date('1970-01-01T00:00:00.000Z');
  if (input.metric === 'reactions') {
    return prisma.$queryRaw<RankedRow[]>`
      WITH totals AS (
        SELECT "user_id", SUM("value")::bigint AS "total"
        FROM "community_activity_daily"
        WHERE "guild_id" = ${input.guildId}
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
      LIMIT ${input.limit}
    `;
  }

  const databaseMetric = activityMetric(input.metric);
  return prisma.$queryRaw<RankedRow[]>`
    WITH totals AS (
      SELECT "user_id", SUM("value")::bigint AS "total"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${input.guildId}
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
    LIMIT ${input.limit}
  `;
}

async function rankRows(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    metric: CommunityLeaderboardStorageMetric;
    start?: Date;
    seasonKey?: string;
  },
): Promise<RankRow[]> {
  if (input.metric === 'xp') {
    return prisma.$queryRaw<RankRow[]>`
      WITH ranked AS (
        SELECT
          "user_id",
          "xp"::bigint AS "total",
          ROW_NUMBER() OVER (ORDER BY "xp" DESC, "updated_at" ASC, "user_id" ASC)::bigint AS "rank",
          COUNT(*) OVER()::bigint AS "participants"
        FROM "xp_profiles"
        WHERE "guild_id" = ${input.guildId}
      )
      SELECT "user_id" AS "userId", "total", "rank", "participants"
      FROM ranked
      WHERE "user_id" = ${input.userId}
      LIMIT 1
    `;
  }

  if (input.metric === 'achievements') {
    const start = input.start ?? new Date('1970-01-01T00:00:00.000Z');
    return prisma.$queryRaw<RankRow[]>`
      WITH totals AS (
        SELECT "user_id", COUNT(*)::bigint AS "total"
        FROM "achievement_unlocks"
        WHERE "guild_id" = ${input.guildId}
          AND "unlocked_at" >= ${start}
          AND "achievement_id" NOT LIKE 'blocked:%'
        GROUP BY "user_id"
      ), ranked AS (
        SELECT
          "user_id",
          "total",
          ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::bigint AS "rank",
          COUNT(*) OVER()::bigint AS "participants"
        FROM totals
      )
      SELECT "user_id" AS "userId", "total", "rank", "participants"
      FROM ranked
      WHERE "user_id" = ${input.userId}
      LIMIT 1
    `;
  }

  if (input.metric === 'season') {
    const seasonKey = requireSeasonKey(input.seasonKey);
    return prisma.$queryRaw<RankRow[]>`
      WITH snapshot_meta AS (
        SELECT "participant_count"
        FROM "community_season_snapshots"
        WHERE "guild_id" = ${input.guildId} AND "season_key" = ${seasonKey}
        LIMIT 1
      ), snapshot_target AS (
        SELECT
          e."user_id",
          e."points"::bigint AS "total",
          e."rank"::bigint AS "rank",
          s."participant_count"::bigint AS "participants"
        FROM "community_season_snapshot_entries" e
        JOIN "community_season_snapshots" s
          ON s."guild_id" = e."guild_id" AND s."season_key" = e."season_key"
        WHERE e."guild_id" = ${input.guildId}
          AND e."season_key" = ${seasonKey}
          AND e."user_id" = ${input.userId}
      ), live_totals AS (
        SELECT "user_id", SUM("points")::bigint AS "total"
        FROM "community_challenge_completions"
        WHERE "guild_id" = ${input.guildId} AND "season_key" = ${seasonKey}
        GROUP BY "user_id"
      ), live_ranked AS (
        SELECT
          "user_id",
          "total",
          ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::bigint AS "rank",
          COUNT(*) OVER()::bigint AS "participants"
        FROM live_totals
      )
      SELECT "user_id" AS "userId", "total", "rank", "participants"
      FROM snapshot_target
      UNION ALL
      SELECT "user_id" AS "userId", "total", "rank", "participants"
      FROM live_ranked
      WHERE "user_id" = ${input.userId}
        AND NOT EXISTS (SELECT 1 FROM snapshot_meta)
      LIMIT 1
    `;
  }

  const start = input.start ?? new Date('1970-01-01T00:00:00.000Z');
  if (input.metric === 'reactions') {
    return prisma.$queryRaw<RankRow[]>`
      WITH totals AS (
        SELECT "user_id", SUM("value")::bigint AS "total"
        FROM "community_activity_daily"
        WHERE "guild_id" = ${input.guildId}
          AND "metric" IN ('reactions_given', 'reactions_received')
          AND "activity_date" >= ${start}
        GROUP BY "user_id"
      ), ranked AS (
        SELECT
          "user_id",
          "total",
          ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::bigint AS "rank",
          COUNT(*) OVER()::bigint AS "participants"
        FROM totals
      )
      SELECT "user_id" AS "userId", "total", "rank", "participants"
      FROM ranked
      WHERE "user_id" = ${input.userId}
      LIMIT 1
    `;
  }

  const start = input.start ?? new Date('1970-01-01T00:00:00.000Z');
  const databaseMetric = activityMetric(input.metric);
  return prisma.$queryRaw<RankRow[]>`
    WITH totals AS (
      SELECT "user_id", SUM("value")::bigint AS "total"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${input.guildId}
        AND "metric" = ${databaseMetric}
        AND "activity_date" >= ${start}
      GROUP BY "user_id"
    ), ranked AS (
      SELECT
        "user_id",
        "total",
        ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::bigint AS "rank",
        COUNT(*) OVER()::bigint AS "participants"
      FROM totals
    )
    SELECT "user_id" AS "userId", "total", "rank", "participants"
    FROM ranked
    WHERE "user_id" = ${input.userId}
    LIMIT 1
  `;
}

function activityMetric(metric: CommunityLeaderboardStorageMetric): string {
  if (metric === 'messages') return 'messages';
  if (metric === 'voice') return 'voice_seconds';
  if (metric === 'minecraft') return 'minecraft_seconds';
  throw new Error(`Unsupported activity metric: ${metric}`);
}

function requireSeasonKey(value: string | undefined): string {
  if (!value?.trim()) throw new Error('seasonKey is required for season leaderboard');
  return value;
}
