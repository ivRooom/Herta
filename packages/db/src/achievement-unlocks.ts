import type { PrismaClient } from '@prisma/client';

const ACHIEVEMENT_BLOCK_PREFIX = 'blocked:';

/**
 * apps/bot/src/plugins/achievements-repository.tsの同名関数と同じロジック。
 * apps/studio(MBTI Web回答完了時のAchievement解除)からもBot側のachievement-repository.ts
 * 全体(bot専用の実績メトリクス計算を多数含む大きなファイル)をimportせずに呼べるよう、
 * このdedupe+insertロジックだけを独立して持つ。
 */
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

function achievementIdFromBlockedRecord(recordId: string): string | null {
  return recordId.startsWith(ACHIEVEMENT_BLOCK_PREFIX)
    ? recordId.slice(ACHIEVEMENT_BLOCK_PREFIX.length)
    : null;
}
