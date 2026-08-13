import { ACHIEVEMENTS, achievementPoints } from '@herta/shared';
import { prisma } from '@/lib/db';

const BLOCK_PREFIX = 'blocked:';
const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const ACHIEVEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,119}$/u;

export type AchievementOperationAction = 'grant' | 'revoke';

export interface AchievementCatalogItem {
  id: string;
  name: string;
  emoji: string;
  category: string;
  rarity: string;
  points: number;
  source: 'built-in' | 'custom';
}

export interface AchievementRecentUnlock extends AchievementCatalogItem {
  userId: string;
  unlockedAt: string;
}

export interface AchievementLeaderboardEntry {
  userId: string;
  unlockCount: number;
  points: number;
}

export interface AchievementOperationsSnapshot {
  totalCatalog: number;
  totalUnlocks: number;
  uniqueMembers: number;
  unlocks7d: number;
  blockedOverrides: number;
  recentUnlocks: AchievementRecentUnlock[];
  leaderboard: AchievementLeaderboardEntry[];
}

export interface AchievementUserProgress {
  userId: string;
  unlockedCount: number;
  blockedCount: number;
  totalCatalog: number;
  progressPercent: number;
  points: number;
  unlockedIds: string[];
  blockedIds: string[];
  unlocked: AchievementCatalogItem[];
  blocked: AchievementCatalogItem[];
}

export interface AchievementOperationRequest {
  action: AchievementOperationAction;
  userId: string;
  achievementId: string;
  reason: string | null;
}

export class AchievementOperationValidationError extends Error {}

export function achievementBlockRecordId(achievementId: string): string {
  return `${BLOCK_PREFIX}${achievementId}`;
}

export function parseAchievementOperationRequest(
  value: unknown,
): AchievementOperationRequest | null {
  if (!isRecord(value)) return null;
  if (value.action !== 'grant' && value.action !== 'revoke') return null;
  if (typeof value.userId !== 'string' || !DISCORD_ID_PATTERN.test(value.userId)) return null;
  if (
    typeof value.achievementId !== 'string' ||
    !ACHIEVEMENT_ID_PATTERN.test(value.achievementId)
  ) {
    return null;
  }
  if (value.reason !== undefined && value.reason !== null && typeof value.reason !== 'string') {
    return null;
  }
  const reason = typeof value.reason === 'string' ? value.reason.trim().slice(0, 240) : null;
  return {
    action: value.action,
    userId: value.userId,
    achievementId: value.achievementId,
    reason: reason || null,
  };
}

export function getAchievementCatalog(config: Record<string, unknown>): AchievementCatalogItem[] {
  const builtIn = ACHIEVEMENTS.map((achievement) => ({
    id: achievement.id,
    name: achievement.name,
    emoji: achievement.emoji,
    category: achievement.category,
    rarity: achievement.rarity,
    points: achievementPoints(achievement),
    source: 'built-in' as const,
  }));

  const custom = readCustomAchievementCatalog(config.customAchievements);
  return [...builtIn, ...custom];
}

export async function getAchievementOperationsSnapshot(
  guildId: string,
  config: Record<string, unknown>,
): Promise<AchievementOperationsSnapshot> {
  const catalog = getAchievementCatalog(config);
  const catalogMap = new Map(catalog.map((item) => [item.id, item]));
  const blockPattern = `${BLOCK_PREFIX}%`;
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

  const recentUnlocks = recentRows.flatMap((row) => {
    const definition = catalogMap.get(row.achievementId);
    return definition
      ? [{ ...definition, userId: row.userId, unlockedAt: row.unlockedAt.toISOString() }]
      : [];
  });
  const leaderboard = leaderboardRows.map((row) => ({
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
  if (!DISCORD_ID_PATTERN.test(userId)) {
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
    .filter((id) => !id.startsWith(BLOCK_PREFIX) && catalogMap.has(id));
  const blockedIds = rows
    .map((row) => row.achievementId)
    .filter((id) => id.startsWith(BLOCK_PREFIX))
    .map((id) => id.slice(BLOCK_PREFIX.length))
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
    unlocked: unlockedIds.flatMap((id) => {
      const item = catalogMap.get(id);
      return item ? [item] : [];
    }),
    blocked: blockedIds.flatMap((id) => {
      const item = catalogMap.get(id);
      return item ? [item] : [];
    }),
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

function readCustomAchievementCatalog(value: unknown): AchievementCatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((seriesValue) => {
    if (!isRecord(seriesValue) || seriesValue.enabled === false) return [];
    const seriesKey = readKey(seriesValue.key);
    const seriesName = readText(seriesValue.name, seriesKey || 'Custom Achievement');
    const category = readText(seriesValue.category, 'custom');
    if (!seriesKey || !Array.isArray(seriesValue.stages)) return [];
    return seriesValue.stages.flatMap((stageValue) => {
      if (!isRecord(stageValue)) return [];
      const stageKey = readKey(stageValue.key);
      if (!stageKey) return [];
      return [
        {
          id: `custom:${seriesKey}:${stageKey}`,
          name: `${seriesName} · ${readText(stageValue.name, stageKey)}`,
          emoji: readText(stageValue.emoji, '🏅'),
          category,
          rarity: readText(stageValue.rarity, 'common'),
          points: clampNumber(stageValue.points, 0, 100_000),
          source: 'custom' as const,
        },
      ];
    });
  });
}

function readKey(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value) ? value : '';
}

function readText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.max(min, Math.min(max, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
