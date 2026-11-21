import type { PrismaClient } from '@prisma/client';
import { creditAchievementUnlockIfEnabled } from './common-points-achievement.js';
import type { CommonPointsTransaction } from './common-points-outbox.js';

const ACHIEVEMENT_BLOCK_PREFIX = 'blocked:';

/**
 * Bot/Studio共通の解除・重複排除・任意の共通ポイント積算。
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
  return prisma.$transaction((tx) =>
    syncAchievementUnlocksInTransaction(tx, guildId, userId, achievementIds),
  );
}

/** Use the actual owner's tx so completion/history/achievement/outbox cannot split. */
export async function syncAchievementUnlocksInTransaction(
  tx: CommonPointsTransaction,
  guildId: string,
  userId: string,
  achievementIds: readonly string[],
  occurredAt = new Date(),
): Promise<string[]> {
  if (achievementIds.length === 0) return [];
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`achievement:${guildId}:${userId}`}, 0))`;
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
  const candidates = [...new Set(achievementIds)].filter(
    (id) => !id.startsWith(ACHIEVEMENT_BLOCK_PREFIX) && !existingIds.has(id) && !blockedIds.has(id),
  );
  const newlyUnlocked: string[] = [];
  for (const achievementId of candidates) {
    const inserted = await tx.$executeRaw`
        INSERT INTO "achievement_unlocks" ("guild_id", "user_id", "achievement_id")
        VALUES (${guildId}, ${userId}, ${achievementId})
        ON CONFLICT DO NOTHING
      `;
    if (inserted > 0) {
      await creditAchievementUnlockIfEnabled(tx, guildId, userId, achievementId, occurredAt);
      newlyUnlocked.push(achievementId);
    }
  }
  return newlyUnlocked;
}

function achievementIdFromBlockedRecord(recordId: string): string | null {
  return recordId.startsWith(ACHIEVEMENT_BLOCK_PREFIX)
    ? recordId.slice(ACHIEVEMENT_BLOCK_PREFIX.length)
    : null;
}
