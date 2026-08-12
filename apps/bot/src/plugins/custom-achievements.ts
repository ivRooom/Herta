export const CUSTOM_ACHIEVEMENT_METRICS = [
  'xp',
  'messages',
  'reactionsGiven',
  'reactionsReceived',
  'voiceSeconds',
  'minecraftSeconds',
  'pollVotes',
  'giveawayEntries',
  'eventGoing',
  'suggestions',
  'acceptedSuggestions',
  'challengeCompletions',
  'seasonPoints',
] as const;

export type CustomAchievementMetric = (typeof CUSTOM_ACHIEVEMENT_METRICS)[number];
export type CustomAchievementConditionMode = 'all' | 'any';
export type CustomAchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface CustomAchievementCondition {
  metric: CustomAchievementMetric;
  target: number;
}

export interface CustomAchievementStage {
  key: string;
  name: string;
  description: string;
  emoji: string;
  rarity: CustomAchievementRarity;
  points: number;
  secret: boolean;
  conditions: CustomAchievementCondition[];
  conditionMode: CustomAchievementConditionMode;
  rewardRoleId: string | null;
  notificationChannelId: string | null;
}

export interface CustomAchievementSeries {
  key: string;
  name: string;
  category: string;
  enabled: boolean;
  stages: CustomAchievementStage[];
}

export type CustomAchievementMetrics = Record<CustomAchievementMetric, number>;

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;
const RARITIES = new Set<CustomAchievementRarity>([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);
const METRICS = new Set<CustomAchievementMetric>(CUSTOM_ACHIEVEMENT_METRICS);

export function normalizeCustomAchievementSeries(value: unknown): CustomAchievementSeries[] {
  if (!Array.isArray(value)) return [];
  const result: CustomAchievementSeries[] = [];
  const usedSeriesKeys = new Set<string>();

  for (const rawSeries of value.slice(0, 25)) {
    if (!isRecord(rawSeries)) continue;
    const key = normalizeKey(rawSeries.key);
    if (!key || usedSeriesKeys.has(key)) continue;
    usedSeriesKeys.add(key);

    const stages = normalizeStages(rawSeries.stages);
    if (stages.length === 0) continue;
    result.push({
      key,
      name: readText(rawSeries.name, key, 80),
      category: readText(rawSeries.category, 'custom', 40),
      enabled: rawSeries.enabled !== false,
      stages,
    });
  }

  return result;
}

export function customAchievementUnlockId(seriesKey: string, stageKey: string): string {
  return `custom:${seriesKey}:${stageKey}`;
}

export function unlockedCustomAchievementIds(
  series: readonly CustomAchievementSeries[],
  metrics: CustomAchievementMetrics,
): string[] {
  const unlocked: string[] = [];
  for (const definition of series) {
    if (!definition.enabled) continue;
    for (const stage of definition.stages) {
      const matches = stage.conditions.map(
        (condition) => metrics[condition.metric] >= condition.target,
      );
      const achieved =
        stage.conditionMode === 'any' ? matches.some(Boolean) : matches.every(Boolean);
      if (achieved) unlocked.push(customAchievementUnlockId(definition.key, stage.key));
    }
  }
  return unlocked;
}

export function findCustomAchievementStage(
  series: readonly CustomAchievementSeries[],
  achievementId: string,
): { series: CustomAchievementSeries; stage: CustomAchievementStage } | undefined {
  for (const definition of series) {
    for (const stage of definition.stages) {
      if (customAchievementUnlockId(definition.key, stage.key) === achievementId) {
        return { series: definition, stage };
      }
    }
  }
  return undefined;
}

function normalizeStages(value: unknown): CustomAchievementStage[] {
  if (!Array.isArray(value)) return [];
  const result: CustomAchievementStage[] = [];
  const usedKeys = new Set<string>();

  for (const rawStage of value.slice(0, 10)) {
    if (!isRecord(rawStage)) continue;
    const key = normalizeKey(rawStage.key);
    if (!key || usedKeys.has(key)) continue;
    const conditions = normalizeConditions(rawStage.conditions);
    if (conditions.length === 0) continue;
    usedKeys.add(key);

    result.push({
      key,
      name: readText(rawStage.name, key, 80),
      description: readText(rawStage.description, '', 240),
      emoji: readText(rawStage.emoji, '🏅', 32),
      rarity: readRarity(rawStage.rarity),
      points: clampInteger(rawStage.points, 100, 0, 100_000),
      secret: rawStage.secret === true,
      conditions,
      conditionMode: rawStage.conditionMode === 'any' ? 'any' : 'all',
      rewardRoleId: nullableDiscordId(rawStage.rewardRoleId),
      notificationChannelId: nullableDiscordId(rawStage.notificationChannelId),
    });
  }
  return result;
}

function normalizeConditions(value: unknown): CustomAchievementCondition[] {
  if (!Array.isArray(value)) return [];
  const result: CustomAchievementCondition[] = [];
  for (const rawCondition of value.slice(0, 8)) {
    if (!isRecord(rawCondition) || !METRICS.has(rawCondition.metric as CustomAchievementMetric)) {
      continue;
    }
    result.push({
      metric: rawCondition.metric as CustomAchievementMetric,
      target: clampInteger(rawCondition.target, 1, 1, 2_147_483_647),
    });
  }
  return result;
}

function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  return KEY_PATTERN.test(key) ? key : undefined;
}

function readText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : fallback;
}

function readRarity(value: unknown): CustomAchievementRarity {
  return RARITIES.has(value as CustomAchievementRarity)
    ? (value as CustomAchievementRarity)
    : 'common';
}

function nullableDiscordId(value: unknown): string | null {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value) ? value : null;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
