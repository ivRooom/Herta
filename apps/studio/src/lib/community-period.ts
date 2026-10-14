import { communityDateKey } from './community-metrics';

export const COMMUNITY_PERIOD_PRESETS = [
  { value: '1d', label: '今日', days: 1 },
  { value: '7d', label: '直近7日', days: 7 },
  { value: '14d', label: '直近2週間', days: 14 },
  { value: '30d', label: '直近30日', days: 30 },
  { value: '90d', label: '直近3ヶ月', days: 90 },
  { value: '180d', label: '直近6ヶ月', days: 180 },
  { value: '365d', label: '直近1年', days: 365 },
  { value: '3y', label: '直近3年', days: 1_095 },
  { value: '5y', label: '直近5年', days: 1_825 },
  { value: '10y', label: '直近10年', days: 3_650 },
] as const;
export const COMMUNITY_CUSTOM_RANGE_MAX_DAYS = 3_653;
export const COMMUNITY_DEFAULT_PERIOD = '7d';

export function communityJstToday(now = new Date()): Date {
  const key = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** period/from/toから{period,start,end}を解決する。不正なcustom rangeは既定periodへfail closedする。 */
export function resolveCommunityPeriodRange(
  period: string,
  from: string | undefined,
  to: string | undefined,
): { period: string; start: Date; end: Date } {
  const today = communityJstToday();
  if (period === 'custom') {
    const start = parseDateOnly(from);
    const end = parseDateOnly(to);
    if (start && end && end.getTime() >= start.getTime()) {
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (
        days >= 1 &&
        days <= COMMUNITY_CUSTOM_RANGE_MAX_DAYS &&
        end.getTime() <= today.getTime()
      ) {
        return { period: 'custom', start, end };
      }
    }
    return resolveCommunityPeriodRange(COMMUNITY_DEFAULT_PERIOD, undefined, undefined);
  }
  const preset = COMMUNITY_PERIOD_PRESETS.find((candidate) => candidate.value === period);
  const days =
    preset?.days ??
    COMMUNITY_PERIOD_PRESETS.find((candidate) => candidate.value === COMMUNITY_DEFAULT_PERIOD)!
      .days;
  return {
    period: preset?.value ?? COMMUNITY_DEFAULT_PERIOD,
    start: new Date(today.getTime() - (days - 1) * 86_400_000),
    end: today,
  };
}

export function communityPeriodLabel(range: { period: string; start: Date; end: Date }): string {
  if (range.period === 'custom') {
    return `${communityDateKey(range.start)} 〜 ${communityDateKey(range.end)}`;
  }
  return (
    COMMUNITY_PERIOD_PRESETS.find((candidate) => candidate.value === range.period)?.label ??
    range.period
  );
}
