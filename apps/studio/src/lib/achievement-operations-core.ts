import { ACHIEVEMENTS, achievementPoints } from '@herta/shared';

export const ACHIEVEMENT_OPERATION_BLOCK_PREFIX = 'blocked:';
export const ACHIEVEMENT_OPERATION_DISCORD_ID_PATTERN = /^\d{17,20}$/u;

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
  return `${ACHIEVEMENT_OPERATION_BLOCK_PREFIX}${achievementId}`;
}

export function parseAchievementOperationRequest(
  value: unknown,
): AchievementOperationRequest | null {
  if (!isRecord(value)) return null;
  if (value.action !== 'grant' && value.action !== 'revoke') return null;
  if (
    typeof value.userId !== 'string' ||
    !ACHIEVEMENT_OPERATION_DISCORD_ID_PATTERN.test(value.userId)
  ) {
    return null;
  }
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
