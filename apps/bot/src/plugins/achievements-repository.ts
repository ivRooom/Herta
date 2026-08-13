import type { PrismaClient } from '@herta/db';
import { getCommunitySeasonWindow } from '@herta/shared';

export const ACHIEVEMENT_BLOCK_PREFIX = 'blocked:';

export interface AchievementMetrics {
  xp: number;
  messages: number;
  reactionsGiven: number;
  reactionsReceived: number;
  voiceSeconds: number;
  minecraftSeconds: number;
  pollVotes: number;
  giveawayEntries: number;
  eventGoing: number;
  suggestions: number;
  acceptedSuggestions: number;
  challengeCompletions: number;
  seasonPoints: number;
}

export interface AchievementUnlockRecord {
  achievementId: string;
  unlockedAt: Date;
}

export interface AchievementLeaderboardRecord {
  userId: string;
  unlockCount: number;
  achievementIds: string[];
}

export function blockedAchievementRecordId(achievementId: string): string {
  return `${ACHIEVEMENT_BLOCK_PREFIX}${achievementId}`;
}

export function achievementIdFromBlockedRecord(recordId: string): string | null {
  return recordId.startsWith(ACHIEVEMENT_BLOCK_PREFIX)
    ? recordId.slice(ACHIEVEMENT_BLOCK_PREFIX.length)
    : null;
}

export async function getAchievementMetrics(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<AchievementMetrics> {
  const seasonKey = getCommunitySeasonWindow(now).key;
  const [row] = await prisma.$queryRaw<
    Array<{
      xp: bigint;
      messages: bigint;
      reactionsGiven: bigint;
      reactionsReceived: bigint;
      voiceSeconds: bigint;
      minecraftSeconds: bigint;
      pollVotes: bigint;
      giveawayEntries: bigint;
      eventGoing: bigint;
      suggestions: bigint;
      acceptedSuggestions: bigint;
      challengeCompletions: bigint;
      seasonPoints: bigint;
    }>
  >`
    SELECT
      COALESCE((SELECT "xp" FROM "xp_profiles" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}), 0)::bigint AS "xp",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'messages'), 0)::bigint AS "messages",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'reactions_given'), 0)::bigint AS "reactionsGiven",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'reactions_received'), 0)::bigint AS "reactionsReceived",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'voice_seconds'), 0)::bigint AS "voiceSeconds",
      COALESCE((SELECT SUM("value") FROM "community_activity_daily" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId} AND "metric" = 'minecraft_seconds'), 0)::bigint AS "minecraftSeconds",
      (SELECT COUNT(DISTINCT v."poll_id") FROM "poll_votes" v JOIN "polls" p ON p."id" = v."poll_id" WHERE p."guild_id" = ${guildId} AND v."user_id" = ${userId})::bigint AS "pollVotes",
      (SELECT COUNT(DISTINCT e."giveaway_id") FROM "giveaway_entries" e JOIN "giveaways" g ON g."id" = e."giveaway_id" WHERE g."guild_id" = ${guildId} AND e."user_id" = ${userId})::bigint AS "giveawayEntries",
      (SELECT COUNT(DISTINCT r."event_id") FROM "event_rsvps" r JOIN "community_events" e ON e."id" = r."event_id" WHERE e."guild_id" = ${guildId} AND r."user_id" = ${userId} AND r."status" = 'going')::bigint AS "eventGoing",
      (SELECT COUNT(*) FROM "suggestions" s WHERE s."guild_id" = ${guildId} AND s."author_id" = ${userId})::bigint AS "suggestions",
      (SELECT COUNT(*) FROM "suggestions" s WHERE s."guild_id" = ${guildId} AND s."author_id" = ${userId} AND s."status" IN ('accepted', 'completed'))::bigint AS "acceptedSuggestions",
      (SELECT COUNT(*) FROM "community_challenge_completions" c WHERE c."guild_id" = ${guildId} AND c."user_id" = ${userId})::bigint AS "challengeCompletions",
      COALESCE((SELECT SUM(c."points") FROM "community_challenge_completions" c WHERE c."guild_id" = ${guildId} AND c."user_id" = ${userId} AND c."season_key" = ${seasonKey}), 0)::bigint AS "seasonPoints"
  `;
  return {
    xp: Number(row?.xp ?? 0n),
    messages: Number(row?.messages ?? 0n),
    reactionsGiven: Number(row?.reactionsGiven ?? 0n),
    reactionsReceived: Number(row?.reactionsReceived ?? 0n),
    voiceSeconds: Number(row?.voiceSeconds ?? 0n),
    minecraftSeconds: Number(row?.minecraftSeconds ?? 0n),
    pollVotes: Number(row?.pollVotes ?? 0n),
    giveawayEntries: Number(row?.giveawayEntries ?? 0n),
    eventGoing: Number(row?.eventGoing ?? 0n),
    suggestions: Number(row?.suggestions ?? 0n),
    acceptedSuggestions: Number(row?.acceptedSuggestions ?? 0n),
    challengeCompletions: Number(row?.challengeCompletions ?? 0n),
    seasonPoints: Number(row?.seasonPoints ?? 0n),
  };
}

export async function listAchievementUnlocks(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<AchievementUnlockRecord[]> {
  return prisma.$queryRaw<AchievementUnlockRecord[]>`
    SELECT "achievement_id" AS "achievementId", "unlocked_at" AS "unlockedAt"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    ORDER BY "unlocked_at" ASC, "achievement_id" ASC
  `;
}

export async function listAchievementLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  limit: number,
): Promise<AchievementLeaderboardRecord[]> {
  const safeLimit = Math.max(5, Math.min(25, Math.trunc(limit)));
  const rows = await prisma.$queryRaw<
    Array<{ userId: string; unlockCount: bigint; achievementIds: string[] }>
  >`
    SELECT
      "user_id" AS "userId",
      COUNT(*)::bigint AS "unlockCount",
      ARRAY_AGG("achievement_id" ORDER BY "achievement_id") AS "achievementIds"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId} AND "achievement_id" NOT LIKE ${`${ACHIEVEMENT_BLOCK_PREFIX}%`}
    GROUP BY "user_id"
    ORDER BY COUNT(*) DESC, "user_id" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    userId: row.userId,
    unlockCount: Number(row.unlockCount),
    achievementIds: row.achievementIds,
  }));
}

export async function syncAchievementUnlocks(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  achievementIds: readonly string[],
): Promise<string[]> {
  if (achievementIds.length === 0) return [];
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`achievement:${guildId}:${userId}`}, 0))`;
    const existing = await tx.$queryRaw<Array<{ achievementId: string }>>`
      SELECT "achievement_id" AS "achievementId"
      FROM "achievement_unlocks"
      WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    `;
    const existingIds = new Set(existing.map((record) => record.achievementId));
    const blockedIds = new Set(
      existing.flatMap((record) => {
        const id = achievementIdFromBlockedRecord(record.achievementId);
        return id ? [id] : [];
      }),
    );
    const newlyUnlocked = achievementIds.filter(
      (id) => !existingIds.has(id) && !blockedIds.has(id),
    );
    for (const achievementId of newlyUnlocked) {
      await tx.$executeRaw`
        INSERT INTO "achievement_unlocks" ("guild_id", "user_id", "achievement_id")
        VALUES (${guildId}, ${userId}, ${achievementId})
        ON CONFLICT DO NOTHING
      `;
    }
    return newlyUnlocked;
  });
}
