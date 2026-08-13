import { prisma } from '@/lib/db';
import {
  ACHIEVEMENT_OPERATION_BLOCK_PREFIX,
  ACHIEVEMENT_OPERATION_DISCORD_ID_PATTERN,
  AchievementOperationValidationError,
  achievementBlockRecordId,
  getAchievementCatalog,
  type AchievementCatalogItem,
  type AchievementLeaderboardEntry,
  type AchievementOperationRequest,
  type AchievementOperationsSnapshot,
  type AchievementRecentUnlock,
  type AchievementUserProgress,
} from './achievement-operations-core';

export {
  AchievementOperationValidationError,
  achievementBlockRecordId,
  getAchievementCatalog,
  parseAchievementOperationRequest,
} from './achievement-operations-core';
export type {
  AchievementCatalogItem,
  AchievementLeaderboardEntry,
  AchievementOperationAction,
  AchievementOperationRequest,
  AchievementOperationsSnapshot,
  AchievementRecentUnlock,
  AchievementUserProgress,
} from './achievement-operations-core';

export async function getAchievementOperationsSnapshot(
  guildId: string,
  config: Record<string, unknown>,
): Promise<AchievementOperationsSnapshot> {
  const catalog = getAchievementCatalog(config);
  const catalogMap = new Map(catalog.map((item) => [item.id, item]));
  const blockPattern = `${ACHIEVEMENT_OPERATION_BLOCK_PREFIX}%`;
  const [summary] = await prisma.$queryRaw<
    Array<{
      totalUnlocks: bigint;
      uniqueMembers: bigint;
      unlocks7d: bigint;
      blockedOverrides: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "achievement_id" NOT LIKE ${blockPattern})::bigint AS "totalUnlocks",
      COUNT(DISTINCT "user_id") FILTER (WHERE "achievement_id" NOT LIKE ${blockPattern})::bigint AS "uniqueMembers",
      COUNT(*) FILTER (
        WHERE "achievement_id" NOT LIKE ${blockPattern}
          AND "unlocked_at" >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      )::bigint AS "unlocks7d",
      COUNT(*) FILTER (WHERE "achievement_id" LIKE ${blockPattern})::bigint AS "blockedOverrides"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId}
  `;

  const recentRows = await prisma.$queryRaw<
    Array<{ userId: string; achievementId: string; unlockedAt: Date }>
  >`
    SELECT
      "user_id" AS "userId",
      "achievement_id" AS "achievementId",
      "unlocked_at" AS "unlockedAt"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId} AND "achievement_id" NOT LIKE ${blockPattern}
    ORDER BY "unlocked_at" DESC
    LIMIT 12
  `;

  const leaderboardRows = await prisma.$queryRaw<
    Array<{ userId: string; achievementIds: string[]; unlockCount: bigint }>
  >`
    SELECT
      "user_id" AS "userId",
      ARRAY_AGG("achievement_id" ORDER BY "achievement_id") AS "achievementIds",
      COUNT(*)::bigint AS "unlockCount"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId} AND "achievement_id" NOT LIKE ${blockPattern}
    GROUP BY "user_id"
    ORDER BY COUNT(*) DESC, "user_id" ASC
    LIMIT 10
  `;

  const recentUnlocks: AchievementRecentUnlock[] = recentRows.flatMap((row) => {
    const definition = catalogMap.get(row.achievementId);
    return definition
      ? [{ ...definition, userId: row.userId, unlockedAt: row.unlockedAt.toISOString() }]
      : [];
  });
  const leaderboard: AchievementLeaderboardEntry[] = leaderboardRows.map((row) => ({
    userId: row.userId,
    unlockCount: Number(row.unlockCount),
    points: row.achievementIds.reduce((total, id) => total + (catalogMap.get(id)?.points ?? 0), 0),
  }));

  return {
    totalCatalog: catalog.length,
    totalUnlocks: Number(summary?.totalUnlocks ?? 0n),
    uniqueMembers: Number(summary?.uniqueMembers ?? 0n),
    unlocks7d: Number(summary?.unlocks7d ?? 0n),
    blockedOverrides: Number(summary?.blockedOverrides ?? 0n),
    recentUnlocks,
    leaderboard,
  };
}

export async function getAchievementUserProgress(
  guildId: string,
  userId: string,
  config: Record<string, unknown>,
): Promise<AchievementUserProgress> {
  if (!ACHIEVEMENT_OPERATION_DISCORD_ID_PATTERN.test(userId)) {
    throw new AchievementOperationValidationError('DiscordユーザーIDが不正です');
  }
  const catalog = getAchievementCatalog(config);
  const catalogMap = new Map(catalog.map((item) => [item.id, item]));
  const rows = await prisma.$queryRaw<Array<{ achievementId: string }>>`
    SELECT "achievement_id" AS "achievementId"
    FROM "achievement_unlocks"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    ORDER BY "unlocked_at" DESC, "achievement_id" ASC
  `;
  const unlockedIds = rows
    .map((row) => row.achievementId)
    .filter(
      (id) => !id.startsWith(ACHIEVEMENT_OPERATION_BLOCK_PREFIX) && catalogMap.has(id),
    );
  const blockedIds = rows
    .map((row) => row.achievementId)
    .filter((id) => id.startsWith(ACHIEVEMENT_OPERATION_BLOCK_PREFIX))
    .map((id) => id.slice(ACHIEVEMENT_OPERATION_BLOCK_PREFIX.length))
    .filter((id) => catalogMap.has(id));
  const points = unlockedIds.reduce((total, id) => total + (catalogMap.get(id)?.points ?? 0), 0);

  return {
    userId,
    unlockedCount: unlockedIds.length,
    blockedCount: blockedIds.length,
    totalCatalog: catalog.length,
    progressPercent:
      catalog.length === 0 ? 0 : Math.round((unlockedIds.length / catalog.length) * 100),
    points,
    unlockedIds,
    blockedIds,
    unlocked: resolveCatalogItems(unlockedIds, catalogMap),
    blocked: resolveCatalogItems(blockedIds, catalogMap),
  };
}

export async function applyAchievementOperation(input: {
  guildId: string;
  actorId: string;
  config: Record<string, unknown>;
  request: AchievementOperationRequest;
}): Promise<{ changed: boolean; state: 'granted' | 'revoked' }> {
  const catalog = getAchievementCatalog(input.config);
  if (!catalog.some((item) => item.id === input.request.achievementId)) {
    throw new AchievementOperationValidationError('対象Achievementが見つかりません');
  }
  const blockId = achievementBlockRecordId(input.request.achievementId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`achievement:${input.guildId}:${input.request.userId}`}, 0))`;
    let changed = false;
    if (input.request.action === 'grant') {
      const removed = await tx.$executeRaw`
        DELETE FROM "achievement_unlocks"
        WHERE "guild_id" = ${input.guildId}
          AND "user_id" = ${input.request.userId}
          AND "achievement_id" = ${blockId}
      `;
      const inserted = await tx.$executeRaw`
        INSERT INTO "achievement_unlocks" ("guild_id", "user_id", "achievement_id")
        VALUES (${input.guildId}, ${input.request.userId}, ${input.request.achievementId})
        ON CONFLICT DO NOTHING
      `;
      changed = Number(removed) > 0 || Number(inserted) > 0;
    } else {
      const removed = await tx.$executeRaw`
        DELETE FROM "achievement_unlocks"
        WHERE "guild_id" = ${input.guildId}
          AND "user_id" = ${input.request.userId}
          AND "achievement_id" = ${input.request.achievementId}
      `;
      const inserted = await tx.$executeRaw`
        INSERT INTO "achievement_unlocks" ("guild_id", "user_id", "achievement_id")
        VALUES (${input.guildId}, ${input.request.userId}, ${blockId})
        ON CONFLICT DO NOTHING
      `;
      changed = Number(removed) > 0 || Number(inserted) > 0;
    }

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event:
          input.request.action === 'grant'
            ? 'achievement.manual_grant'
            : 'achievement.manual_revoke',
        targetType: 'achievement',
        targetId: input.request.achievementId,
        changes: {
          userId: input.request.userId,
          state: input.request.action === 'grant' ? 'granted' : 'revoked',
          changed,
        },
        metadata: {
          operationSource: 'dashboard',
          reason: input.request.reason,
        },
      },
    });

    return {
      changed,
      state: input.request.action === 'grant' ? ('granted' as const) : ('revoked' as const),
    };
  });
}

function resolveCatalogItems(
  ids: string[],
  catalogMap: Map<string, AchievementCatalogItem>,
): AchievementCatalogItem[] {
  return ids.flatMap((id) => {
    const item = catalogMap.get(id);
    return item ? [item] : [];
  });
}
