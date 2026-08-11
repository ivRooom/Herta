import type { PrismaClient } from '@herta/db';

export interface AchievementMetrics {
  xp: number;
  pollVotes: number;
  giveawayEntries: number;
  eventGoing: number;
  suggestions: number;
  acceptedSuggestions: number;
}

export interface AchievementUnlockRecord {
  achievementId: string;
  unlockedAt: Date;
}

export async function getAchievementMetrics(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<AchievementMetrics> {
  const [row] = await prisma.$queryRaw<Array<{
    xp: bigint;
    pollVotes: bigint;
    giveawayEntries: bigint;
    eventGoing: bigint;
    suggestions: bigint;
    acceptedSuggestions: bigint;
  }>>`
    SELECT
      COALESCE((SELECT "xp" FROM "xp_profiles" WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}), 0)::bigint AS "xp",
      (SELECT COUNT(DISTINCT v."poll_id") FROM "poll_votes" v JOIN "polls" p ON p."id" = v."poll_id" WHERE p."guild_id" = ${guildId} AND v."user_id" = ${userId})::bigint AS "pollVotes",
      (SELECT COUNT(DISTINCT e."giveaway_id") FROM "giveaway_entries" e JOIN "giveaways" g ON g."id" = e."giveaway_id" WHERE g."guild_id" = ${guildId} AND e."user_id" = ${userId})::bigint AS "giveawayEntries",
      (SELECT COUNT(DISTINCT r."event_id") FROM "event_rsvps" r JOIN "community_events" e ON e."id" = r."event_id" WHERE e."guild_id" = ${guildId} AND r."user_id" = ${userId} AND r."status" = 'going')::bigint AS "eventGoing",
      (SELECT COUNT(*) FROM "suggestions" s WHERE s."guild_id" = ${guildId} AND s."author_id" = ${userId})::bigint AS "suggestions",
      (SELECT COUNT(*) FROM "suggestions" s WHERE s."guild_id" = ${guildId} AND s."author_id" = ${userId} AND s."status" IN ('accepted', 'completed'))::bigint AS "acceptedSuggestions"
  `;
  return {
    xp: Number(row?.xp ?? 0n),
    pollVotes: Number(row?.pollVotes ?? 0n),
    giveawayEntries: Number(row?.giveawayEntries ?? 0n),
    eventGoing: Number(row?.eventGoing ?? 0n),
    suggestions: Number(row?.suggestions ?? 0n),
    acceptedSuggestions: Number(row?.acceptedSuggestions ?? 0n),
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
    const newlyUnlocked = achievementIds.filter((id) => !existingIds.has(id));
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
