import type { PrismaClient } from '@herta/db';
import type {
  CommunityChallengeDefinition,
  CommunityChallengeMetric,
  CommunityChallengePeriod,
} from '@herta/shared';

export type CommunityChallengeMetricValues = Record<CommunityChallengeMetric, number>;

export interface CommunityChallengeAssignmentRecord {
  periodType: CommunityChallengePeriod;
  periodKey: string;
  challengeIds: string[];
  createdAt: Date;
}

export interface CommunityChallengeCompletionRecord {
  challengeId: string;
  points: number;
  completedAt: Date;
}

export interface NewlyCompletedChallenge {
  definition: CommunityChallengeDefinition;
  points: number;
}

export interface CommunitySeasonSummary {
  points: number;
  completionCount: number;
  rank: number | null;
  participants: number;
}

export interface CommunitySeasonLeaderboardRecord {
  userId: string;
  points: number;
  completionCount: number;
}

type ChallengeTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export async function getCommunityChallengeMetrics(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  startDateKey: string,
  endDateKey: string,
): Promise<CommunityChallengeMetricValues> {
  const rows = await prisma.$queryRaw<Array<{ metric: CommunityChallengeMetric; total: bigint }>>`
    SELECT "metric"::text AS "metric", COALESCE(SUM("value"), 0)::bigint AS "total"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "activity_date" >= ${startDateKey}::date
      AND "activity_date" < ${endDateKey}::date
      AND "metric" IN (
        'messages', 'reactions_given', 'reactions_received', 'voice_seconds', 'minecraft_seconds',
        'minigame_plays', 'minigame_wins', 'highlow_round_wins', 'blackjack_wins'
      )
    GROUP BY "metric"
  `;
  const result: CommunityChallengeMetricValues = {
    messages: 0,
    reactions_given: 0,
    reactions_received: 0,
    voice_seconds: 0,
    minecraft_seconds: 0,
    minigame_plays: 0,
    minigame_wins: 0,
    highlow_round_wins: 0,
    blackjack_wins: 0,
  };
  for (const row of rows) result[row.metric] = Number(row.total);
  return result;
}

export async function ensureCommunityChallengeAssignment(
  prisma: PrismaClient,
  guildId: string,
  periodType: CommunityChallengePeriod,
  periodKey: string,
  challengeIds: readonly string[],
): Promise<CommunityChallengeAssignmentRecord> {
  const normalized = [...new Set(challengeIds.filter((id) => id.length > 0))].slice(0, 5);
  if (normalized.length === 0)
    throw new Error('Community Challenge assignment requires at least one challenge');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`community-challenge-assignment:${guildId}:${periodType}:${periodKey}`}, 0)
      )
    `;
    const existing = await readAssignment(tx, guildId, periodType, periodKey);
    if (existing) return existing;
    const rows = await tx.$queryRaw<CommunityChallengeAssignmentRecord[]>`
      INSERT INTO "community_challenge_assignments" (
        "guild_id", "period_type", "period_key", "challenge_ids"
      ) VALUES (${guildId}, ${periodType}, ${periodKey}, ${normalized}::text[])
      RETURNING
        "period_type" AS "periodType",
        "period_key" AS "periodKey",
        "challenge_ids" AS "challengeIds",
        "created_at" AS "createdAt"
    `;
    const created = rows[0];
    if (!created) throw new Error('Community Challenge assignment insert returned no row');
    return created;
  });
}

export async function listCommunityChallengeCompletions(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  periodType: CommunityChallengePeriod,
  periodKey: string,
): Promise<CommunityChallengeCompletionRecord[]> {
  const rows = await prisma.$queryRaw<
    Array<{ challengeId: string; points: number; completedAt: Date }>
  >`
    SELECT
      "challenge_id" AS "challengeId",
      "points",
      "completed_at" AS "completedAt"
    FROM "community_challenge_completions"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "period_type" = ${periodType}
      AND "period_key" = ${periodKey}
    ORDER BY "completed_at" ASC, "challenge_id" ASC
  `;
  return rows;
}

export async function syncCommunityChallengeCompletions(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    periodType: CommunityChallengePeriod;
    periodKey: string;
    seasonKey: string;
    definitions: readonly CommunityChallengeDefinition[];
    metrics: CommunityChallengeMetricValues;
    pointMultiplier: number;
  },
): Promise<NewlyCompletedChallenge[]> {
  const eligible = input.definitions.filter(
    (definition) => input.metrics[definition.metric] >= definition.target,
  );
  if (eligible.length === 0) return [];
  const multiplier = Math.max(1, Math.min(3, Math.trunc(input.pointMultiplier)));
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`community-challenge:${input.guildId}:${input.userId}:${input.periodType}:${input.periodKey}`},
          0
        )
      )
    `;
    const existing = await tx.$queryRaw<Array<{ challengeId: string }>>`
      SELECT "challenge_id" AS "challengeId"
      FROM "community_challenge_completions"
      WHERE "guild_id" = ${input.guildId}
        AND "user_id" = ${input.userId}
        AND "period_type" = ${input.periodType}
        AND "period_key" = ${input.periodKey}
    `;
    const existingIds = new Set(existing.map((row) => row.challengeId));
    const newlyCompleted: NewlyCompletedChallenge[] = [];
    for (const definition of eligible) {
      if (existingIds.has(definition.id)) continue;
      const points = definition.basePoints * multiplier;
      const inserted = await tx.$queryRaw<Array<{ challengeId: string }>>`
        INSERT INTO "community_challenge_completions" (
          "guild_id", "user_id", "challenge_id", "period_type", "period_key",
          "season_key", "points"
        ) VALUES (
          ${input.guildId}, ${input.userId}, ${definition.id}, ${input.periodType},
          ${input.periodKey}, ${input.seasonKey}, ${points}
        )
        ON CONFLICT DO NOTHING
        RETURNING "challenge_id" AS "challengeId"
      `;
      if (inserted[0]) newlyCompleted.push({ definition, points });
    }
    return newlyCompleted;
  });
}

export async function getCommunitySeasonSummary(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  seasonKey: string,
): Promise<CommunitySeasonSummary> {
  const rows = await prisma.$queryRaw<
    Array<{ points: bigint; completionCount: bigint; rank: bigint | null; participants: bigint }>
  >`
    WITH totals AS (
      SELECT
        "user_id",
        SUM("points")::bigint AS "points",
        COUNT(*)::bigint AS "completionCount"
      FROM "community_challenge_completions"
      WHERE "guild_id" = ${guildId} AND "season_key" = ${seasonKey}
      GROUP BY "user_id"
    ), ranked AS (
      SELECT
        "user_id",
        "points",
        "completionCount",
        ROW_NUMBER() OVER (
          ORDER BY "points" DESC, "completionCount" DESC, "user_id" ASC
        )::bigint AS "rank"
      FROM totals
    )
    SELECT
      COALESCE(ranked."points", 0)::bigint AS "points",
      COALESCE(ranked."completionCount", 0)::bigint AS "completionCount",
      ranked."rank",
      (SELECT COUNT(*)::bigint FROM totals) AS "participants"
    FROM (VALUES (1)) AS seed(value)
    LEFT JOIN ranked ON ranked."user_id" = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  return {
    points: Number(row?.points ?? 0n),
    completionCount: Number(row?.completionCount ?? 0n),
    rank: row?.rank === null || row?.rank === undefined ? null : Number(row.rank),
    participants: Number(row?.participants ?? 0n),
  };
}

export async function listCommunitySeasonLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  seasonKey: string,
  limit: number,
): Promise<CommunitySeasonLeaderboardRecord[]> {
  const safeLimit = Math.max(5, Math.min(25, Math.trunc(limit)));
  const rows = await prisma.$queryRaw<
    Array<{ userId: string; points: bigint; completionCount: bigint }>
  >`
    SELECT
      "user_id" AS "userId",
      SUM("points")::bigint AS "points",
      COUNT(*)::bigint AS "completionCount"
    FROM "community_challenge_completions"
    WHERE "guild_id" = ${guildId} AND "season_key" = ${seasonKey}
    GROUP BY "user_id"
    ORDER BY SUM("points") DESC, COUNT(*) DESC, "user_id" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    userId: row.userId,
    points: Number(row.points),
    completionCount: Number(row.completionCount),
  }));
}

export async function getCommunityDailyClearStreak(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  todayKey: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<
    Array<{ periodKey: string; total: bigint; completed: bigint }>
  >`
    SELECT
      a."period_key" AS "periodKey",
      cardinality(a."challenge_ids")::bigint AS "total",
      COUNT(c."challenge_id")::bigint AS "completed"
    FROM "community_challenge_assignments" a
    LEFT JOIN "community_challenge_completions" c
      ON c."guild_id" = a."guild_id"
      AND c."period_type" = a."period_type"
      AND c."period_key" = a."period_key"
      AND c."user_id" = ${userId}
      AND c."challenge_id" = ANY(a."challenge_ids")
    WHERE a."guild_id" = ${guildId}
      AND a."period_type" = 'daily'
      AND a."period_key" <= ${todayKey}
    GROUP BY a."period_key", a."challenge_ids"
    ORDER BY a."period_key" DESC
    LIMIT 180
  `;
  const clearByDay = new Map(
    rows.map((row) => [
      row.periodKey,
      Number(row.total) > 0 && Number(row.completed) >= Number(row.total),
    ]),
  );
  let cursor = clearByDay.get(todayKey) ? todayKey : previousDateKey(todayKey);
  let streak = 0;
  for (let index = 0; index < 180; index += 1) {
    if (!clearByDay.get(cursor)) break;
    streak += 1;
    cursor = previousDateKey(cursor);
  }
  return streak;
}

export async function getCommunityChallengeAchievementTotals(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  seasonKey: string,
): Promise<{ challengeCompletions: number; seasonPoints: number }> {
  const rows = await prisma.$queryRaw<
    Array<{ challengeCompletions: bigint; seasonPoints: bigint }>
  >`
    SELECT
      (SELECT COUNT(*)::bigint
        FROM "community_challenge_completions"
        WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
      ) AS "challengeCompletions",
      (SELECT COALESCE(SUM("points"), 0)::bigint
        FROM "community_challenge_completions"
        WHERE "guild_id" = ${guildId}
          AND "user_id" = ${userId}
          AND "season_key" = ${seasonKey}
      ) AS "seasonPoints"
  `;
  return {
    challengeCompletions: Number(rows[0]?.challengeCompletions ?? 0n),
    seasonPoints: Number(rows[0]?.seasonPoints ?? 0n),
  };
}

async function readAssignment(
  tx: Pick<ChallengeTransaction, '$queryRaw'>,
  guildId: string,
  periodType: CommunityChallengePeriod,
  periodKey: string,
): Promise<CommunityChallengeAssignmentRecord | null> {
  const rows = await tx.$queryRaw<CommunityChallengeAssignmentRecord[]>`
    SELECT
      "period_type" AS "periodType",
      "period_key" AS "periodKey",
      "challenge_ids" AS "challengeIds",
      "created_at" AS "createdAt"
    FROM "community_challenge_assignments"
    WHERE "guild_id" = ${guildId}
      AND "period_type" = ${periodType}
      AND "period_key" = ${periodKey}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function previousDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
