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
  'online',
  'achievements',
  'season',
] as const;

export type CommunityLeaderboardMetric = (typeof COMMUNITY_LEADERBOARD_METRICS)[number];
export type CommunityLeaderboardPeriod =
  | 'all'
  | '1d'
  | '7d'
  | '14d'
  | '30d'
  | '90d'
  | '180d'
  | '365d'
  | '3y'
  | '5y'
  | '10y'
  | 'season'
  | 'custom';
export type CommunityLeaderboardSeasonStatus = 'current' | 'completed';

/** カスタム期間の開始・終了日(JST calendar date、両端含む)。 */
export interface CommunityLeaderboardCustomRange {
  start: Date;
  end: Date;
}

const CUSTOM_RANGE_MIN_DAYS = 1;
const CUSTOM_RANGE_MAX_DAYS = 3_653; // 約10年(うるう年考慮の安全マージン込み)

/** 日数ベースpreset(all/season/customを除く)のオフセット日数。「7d」なら当日を含む直近7日。 */
const PRESET_DAYS: Partial<Record<CommunityLeaderboardPeriod, number>> = {
  '1d': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
  '3y': 1_095,
  '5y': 1_825,
  '10y': 3_650,
};

export const COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT = 6;

export interface CommunityLeaderboardQuery {
  metric: CommunityLeaderboardMetric;
  period: CommunityLeaderboardPeriod;
  limit: 10 | 25;
  /** period === 'custom' のときのみ非null。 */
  customRange: CommunityLeaderboardCustomRange | null;
}

export interface CommunityLeaderboardMetricDefinition {
  metric: CommunityLeaderboardMetric;
  label: string;
  shortLabel: string;
  description: string;
  periods: readonly CommunityLeaderboardPeriod[];
}

const ACTIVITY_PERIODS: readonly CommunityLeaderboardPeriod[] = [
  '7d',
  '1d',
  '14d',
  '30d',
  '90d',
  '180d',
  '365d',
  '3y',
  '5y',
  '10y',
  'all',
  'custom',
];

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
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'reactions',
    label: 'Reactions',
    shortLabel: 'Reaction',
    description: '送受信したReactionの合計',
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'voice',
    label: 'Voice',
    shortLabel: 'VC',
    description: 'Voice Channelで活動した時間',
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'minecraft',
    label: 'Minecraft',
    shortLabel: 'Minecraft',
    description: 'Minecraft連携で記録された活動時間',
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'online',
    label: 'Online',
    shortLabel: '在席',
    description: 'Discordのステータスがオフライン以外だった時間(要Presence Intent)',
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'achievements',
    label: 'Achievements',
    shortLabel: 'Badge',
    description: '解除したAchievement / Badge数',
    periods: ACTIVITY_PERIODS,
  },
  {
    metric: 'season',
    label: 'Season Point',
    shortLabel: 'Season',
    description: 'Community Challenge Seasonで獲得したPoint',
    periods: ['season'],
  },
] as const;

const PERIOD_LABELS: Record<CommunityLeaderboardPeriod, string> = {
  all: 'All Time',
  '1d': '直近1日',
  '7d': '直近7日',
  '14d': '直近2週間',
  '30d': '直近30日',
  '90d': '直近3ヶ月',
  '180d': '直近6ヶ月',
  '365d': '直近1年',
  '3y': '直近3年',
  '5y': '直近5年',
  '10y': '直近10年',
  season: 'Current Season',
  custom: 'カスタム期間',
};

const METRIC_SET = new Set<string>(COMMUNITY_LEADERBOARD_METRICS);

export function normalizeCommunityLeaderboardQuery(input: {
  metric?: string | null;
  period?: string | null;
  limit?: string | number | null;
  from?: string | null;
  to?: string | null;
}): CommunityLeaderboardQuery {
  const metric = METRIC_SET.has(input.metric ?? '')
    ? (input.metric as CommunityLeaderboardMetric)
    : 'xp';
  const definition = getCommunityLeaderboardDefinition(metric);
  const requestedPeriod = input.period as CommunityLeaderboardPeriod | undefined;
  let period =
    requestedPeriod && definition.periods.includes(requestedPeriod)
      ? requestedPeriod
      : definition.periods[0]!;
  const parsedLimit =
    typeof input.limit === 'number' ? input.limit : Number.parseInt(input.limit ?? '', 10);

  let customRange: CommunityLeaderboardCustomRange | null = null;
  if (period === 'custom') {
    customRange = parseCustomRange(input.from, input.to);
    // カスタム期間が不正(日付でない、順序逆、10年超過等)な場合はこのmetricの
    // 既定periodへfail closedする。無効な巨大範囲でDBへ問い合わせないため。
    if (!customRange)
      period =
        definition.periods.find((candidate) => candidate !== 'custom') ?? definition.periods[0]!;
  }

  return {
    metric,
    period,
    limit: parsedLimit === 25 ? 25 : 10,
    customRange,
  };
}

function parseCustomRange(
  from: string | null | undefined,
  to: string | null | undefined,
): CommunityLeaderboardCustomRange | null {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < CUSTOM_RANGE_MIN_DAYS || days > CUSTOM_RANGE_MAX_DAYS) return null;
  return { start, end };
}

function parseDateOnly(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCommunityLeaderboardDefinition(
  metric: CommunityLeaderboardMetric,
): CommunityLeaderboardMetricDefinition {
  return COMMUNITY_LEADERBOARD_DEFINITIONS.find((definition) => definition.metric === metric)!;
}

export function communityLeaderboardPeriodLabel(
  period: CommunityLeaderboardPeriod,
  customRange: CommunityLeaderboardCustomRange | null = null,
): string {
  if (period === 'custom' && customRange) {
    return `${dateOnlyLabel(customRange.start)} 〜 ${dateOnlyLabel(customRange.end)}`;
  }
  return PERIOD_LABELS[period];
}

function dateOnlyLabel(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
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
  if (metric === 'voice' || metric === 'minecraft' || metric === 'online')
    return formatDuration(value);
  if (metric === 'season') return `${Math.max(0, Math.trunc(value)).toLocaleString()} pt`;
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

/**
 * @param customRange period === 'custom' のときだけ渡す。既存呼び出し元(Discord
 * `/leaderboard`コマンド等)は省略でき、挙動は変わらない。
 */
export function communityActivityPeriodStart(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
  customRange: CommunityLeaderboardCustomRange | null = null,
): Date {
  if (period === 'custom' && customRange) return jstActivityDate(customRange.start);
  const today = jstActivityDate(now);
  if (period === 'all' || period === 'season') return new Date('1970-01-01T00:00:00.000Z');
  const days = PRESET_DAYS[period] ?? 7;
  return new Date(today.getTime() - (days - 1) * 86_400_000);
}

/** activity_date(DATE列)の上限。customRange指定時のみ過去日で打ち切り、それ以外は当日。 */
export function communityActivityPeriodEnd(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
  customRange: CommunityLeaderboardCustomRange | null = null,
): Date {
  if (period === 'custom' && customRange) return jstActivityDate(customRange.end);
  return jstActivityDate(now);
}

export function communityTimestampPeriodStart(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
  customRange: CommunityLeaderboardCustomRange | null = null,
): Date {
  if (period === 'custom' && customRange) return jstMidnightUtc(customRange.start);
  if (period === 'all' || period === 'season') return new Date('1970-01-01T00:00:00.000Z');
  const days = PRESET_DAYS[period] ?? 7;
  return new Date(jstMidnightUtc(now).getTime() - (days - 1) * 86_400_000);
}

/** timestamptz列の上限。customRange指定時はその終了日の23:59:59.999(JST)、それ以外は現在時刻。 */
export function communityTimestampPeriodEnd(
  period: CommunityLeaderboardPeriod,
  now = new Date(),
  customRange: CommunityLeaderboardCustomRange | null = null,
): Date {
  if (period === 'custom' && customRange) {
    return new Date(jstMidnightUtc(customRange.end).getTime() + 86_400_000 - 1);
  }
  return now;
}

function jstMidnightUtc(value: Date): Date {
  const shifted = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      9 * 60 * 60 * 1000,
  );
}

export function listCommunityLeaderboardSeasons(
  now = new Date(),
  limit = COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT,
): CommunitySeasonWindow[] {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.trunc(limit)
    : COMMUNITY_LEADERBOARD_SEASON_HISTORY_LIMIT;
  const safeLimit = Math.max(1, Math.min(12, normalizedLimit));
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
