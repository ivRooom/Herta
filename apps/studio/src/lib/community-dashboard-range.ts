import { startOfJstDay } from '@herta/db';

const DAY_MS = 24 * 60 * 60 * 1_000;

export const COMMUNITY_COMMAND_RANGES = ['24h', '7d', '30d'] as const;

export type CommunityCommandRange = (typeof COMMUNITY_COMMAND_RANGES)[number];

export interface CommunityCommandRangeWindow {
  startAt: Date;
  chartDays: number;
  label: string;
}

export function normalizeCommunityCommandRange(
  value: string | string[] | undefined,
): CommunityCommandRange {
  if (Array.isArray(value)) return '7d';
  if (value === '24h' || value === '30d') return value;
  return '7d';
}

export function resolveCommunityCommandRangeWindow(
  range: CommunityCommandRange,
  now: Date,
): CommunityCommandRangeWindow {
  if (range === '24h') {
    return {
      startAt: new Date(now.getTime() - DAY_MS),
      chartDays: 2,
      label: '過去24時間',
    };
  }

  const chartDays = range === '30d' ? 30 : 7;
  return {
    startAt: new Date(startOfJstDay(now).getTime() - (chartDays - 1) * DAY_MS),
    chartDays,
    label: range === '30d' ? '直近30日' : '直近7日',
  };
}
