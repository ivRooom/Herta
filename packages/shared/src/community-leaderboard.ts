import {
  getCommunitySeasonWindow,
  type CommunitySeasonWindow,
} from './community-challenge-catalog.js';

export const COMMUNITY_LEADERBOARD_METRICS = [
  'xp',
  'level',
  'messages',
  'reactions',
  'voice',
  'minecraft',
  'achievements',
  'season',
] as const;

export type CommunityLeaderboardMetric = (typeof COMMUNITY_LEADERBOARD_METRICS)[number];
export type CommunityLeaderboardPeriod = 'all' | '7d' | '30d' | 'season';
export type CommunityLeaderboardSeasonStatus = 'current' | 'completed';

export const COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT = 6;

export interface CommunityLeaderboardQuery {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardPeriod;
  limit: 10 | 25;
}

export interface CommunityLeaderboardMetricDefinition {
  metric: CommunityLeaderboardMetric;
  label: string;
  shortLabel: string;
  description: string;
  periods: readonly CommunityLeaderboardPeriod[];
}

export const COMMUNITY_LEADERBOARD_DEFINITIONS: readonly CommunityLeaderboardMetricDefinition[] = [
  {
    metric: 'xp',
    label: 'XP',
    shortLabel: 'XP',
    description: 'メッセージ活動で獲得した累計XP',
    periods: ['all'],
  },
  {
    metric: 'level',
    label: 'Level',
    shortLabel: 'Lv',
    description: '累計XPから算出したサーバーLevel',
    periods: ['all'],
  },
  {
    metric: 'messages',
    label: 'Messages',
    shortLabel: '発言',
    description: 'Activity Rulesで集計された発言数',
    periods: ['7d', '30d', 'all'],
  },
  {
    metric: 'reactions',
    label: 'Reactions',
    shortLabel: 'Reaction',
    description: '送受信したReactionの合計',
    periods: ['7d', '30d', 'all'],
  },
  {
    metric: 'voice',
    label: 'Voice',
    shortLabel: 'VC',
    description: 'Voice Channelで活動した時間',
    periods: ['7d', '30d', 'all'],
  },
  {
    metric: 'minecraft',
    label: 'Minecraft',
    shortLabel: 'Minecraft',
    description: 'Minecraft連携で記録された活動時間',
    periods: ['7d', '30d', 'all'],
  },
  {
    metric: 'achievements',
    label: 'Achievements',
    shortLabel: 'Badge',
    description: '解除したAchievement / Badge数',
    periods: ['7d', '30d', 'all'],
  },
  {
    metric: 'season',
    label: 'Season Point',
    shortLabel: 'Season',
    description: '現在のCommunity Challenge Seasonで獲得したPoint',
    periods: ['season'],
  },
] as const;

const PERIOD_LABELS: Record<CommunityLeaderboardPeriod, string> = {
  all: 'All Time',
  '7d': '直近7日',
  '30d': '直近30日',
  season: 'Current Season',
};

const METRIC_SET = new Set<string>(COMMUNITY_LEADERBOARD_METRICS);

export function normalizeCommunityLeaderboardQuery(input: {
  metric?: string | null;
  period?: string | null;
  limit?: string | number | null;
}): CommunityLeaderboardQuery {
  const metric = METRIC_SET.has(input.metric ?? '')
    ? (input.metric as CommunityLeaderboardMetric)
    : 'xp';
  const definition = getCommunityLeaderboardDefinition(metric);
  const requestedPeriod = input.period as CommunityLeaderboardPeriod | undefined;
  const period =
    requestedPeriod && definition.periods.includes(requestedPeriod)
      ? requestedPeriod
      : definition.periods[0]!;
  const parsedLimit =
    typeof input.limit === 'number' ? input.limit : Number.parseInt(input.limit ?? '', 10);

  return {
    metric,
    period,
    limit: parsedLimit === 25 ? 25 : 10,
  };
}

export function getCommunityLeaderboardDefinition(
  metric: CommunityLeaderboardMetric,
): CommunityLeaderboardMetricDefinition {
  return COMMUNITY_LEADERBOARD_DEFINITIONS.find((definition) => definition.metric === metric)!;
}

export function communityLeaderboardPeriodLabel(period: CommunityLeaderboardPeriod): string {
  return PERIOD_LABELS[period];
}

export function communityLeaderboardLevelForXp(xp: number): number {
  return Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

export function formatCommunityLeaderboardValue(
  metric: CommunityLeaderboardMetric,
  value: number,
  secondaryValue?: number | null,
): string {
  if (metric === 'xp') return `${Math.max(0, Math.trunc(value)).toLocaleString()} XP`;
  if (metric === 'level') {
    const xp = Math.max(0, Math.trunc(secondaryValue ?? 0));
    return `Lv.${Math.max(0, Math.trunc(value))} · ${xp.toLocaleString()} XP`;
  }
  if (metric === 'voice' || metric === 'minecraft') return formatDuration(value);
  if (metric === 'season') return `${Math.max(0, Math.trunc(value)).toLocaleString()} pt`;
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

export function communityActivityPeriodStart(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
): Date {
  const today = jstActivityDate(now);
  if (period === 'all' || period === 'season') return new Date('1970-01-01T00:00:00.000Z');
  const days = period === '7d' ? 6 : 29;
  return new Date(today.getTime() - days * 86_400_000);
}

export function communityTimestampPeriodStart(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
): Date {
  if (period === 'all' || period === 'season') return new Date('1970-01-01T00:00:00.000Z');
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const localMidnightUtc =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    9 * 60 * 60 * 1000;
  const days = period === '7d' ? 6 : 29;
  return new Date(localMidnightUtc - days * 86_400_000);
}

export function listCommunityLeaderboardSeasons(
  now = new Date(),
  limit = COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT,
): CommunitySeasonWindow[] {
  const safeLimit = Math.max(1, Math.min(12, Math.trunc(limit)));
  const seasons: CommunitySeasonWindow[] = [];
  let cursor = now;

  for (let index = 0; index < safeLimit; index += 1) {
    const season = getCommunitySeasonWindow(cursor);
    if (seasons.some((candidate) => candidate.key === season.key)) break;
    seasons.push(season);
    if (season.index <= 1) break;
    cursor = new Date(season.startsAt.getTime() - 1);
  }

  return seasons;
}

export function resolveCommunityLeaderboardSeason(
  seasonKey: string | null | undefined,
  now = new Date(),
  limit = COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT,
): CommunitySeasonWindow {
  const seasons = listCommunityLeaderboardSeasons(now, limit);
  const current = seasons[0] ?? getCommunitySeasonWindow(now);
  const normalizedKey = seasonKey?.trim();
  if (!normalizedKey) return current;
  return seasons.find((season) => season.key === normalizedKey) ?? current;
}

export function communityLeaderboardSeasonStatus(
  season: CommunitySeasonWindow,
  now = new Date(),
): CommunityLeaderboardSeasonStatus {
  return now.getTime() >= season.endsAt.getTime() ? 'completed' : 'current';
}

export function communityLeaderboardSeasonDaysRemaining(
  season: CommunitySeasonWindow,
  now = new Date(),
): number {
  if (communityLeaderboardSeasonStatus(season, now) === 'completed') return 0;
  return Math.max(1, Math.ceil((season.endsAt.getTime() - now.getTime()) / 86_400_000));
}

function jstActivityDate(value: Date): Date {
  const key = new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function formatDuration(secondsValue: number): string {
  const totalMinutes = Math.max(0, Math.floor(secondsValue / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours.toLocaleString()}時間`;
  return `${hours.toLocaleString()}時間 ${minutes}分`;
}
