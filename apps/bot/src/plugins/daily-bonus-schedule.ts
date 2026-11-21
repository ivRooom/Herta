// #766 Phase D2 (plan B): only the announcement send time is configurable.
// The slot boundary stays anchored at 09:00 JST: the calendar date, the
// claim window, and the receive deadline in the embed copy never move.
// scheduleTime accepts 09:00-23:59 so a configured send always lands inside
// the slot day it announces; anything else falls back to 09:00.
export const DEFAULT_DAILY_BONUS_SCHEDULE_TIME = '09:00';

const SCHEDULE_TIME_PATTERN = /^(09|1[0-9]|2[0-3]):[0-5][0-9]$/;

export function resolveDailyBonusScheduleTime(value: unknown): string {
  return typeof value === 'string' && SCHEDULE_TIME_PATTERN.test(value)
    ? value
    : DEFAULT_DAILY_BONUS_SCHEDULE_TIME;
}

// Epoch ms at which the announcement for `dateJst` (YYYY-MM-DD) may be sent.
export function dailyBonusSendOpensAt(dateJst: string, scheduleTime: string): number {
  return Date.parse(`${dateJst}T${scheduleTime}:00+09:00`);
}
