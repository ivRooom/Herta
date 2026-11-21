import { describe, expect, it } from 'vitest';
import { dailyBonusSendOpensAt, resolveDailyBonusScheduleTime } from './daily-bonus-schedule.js';

describe('resolveDailyBonusScheduleTime', () => {
  it('passes valid in-slot times through', () => {
    expect(resolveDailyBonusScheduleTime('09:00')).toBe('09:00');
    expect(resolveDailyBonusScheduleTime('12:30')).toBe('12:30');
    expect(resolveDailyBonusScheduleTime('23:59')).toBe('23:59');
  });

  it('falls back to 09:00 for out-of-slot or malformed values', () => {
    for (const value of ['08:59', '00:00', '24:00', '9:00', '12:60', '', undefined, null, 900]) {
      expect(resolveDailyBonusScheduleTime(value)).toBe('09:00');
    }
  });
});

describe('dailyBonusSendOpensAt', () => {
  it('builds the JST open instant for the slot date', () => {
    expect(dailyBonusSendOpensAt('2026-11-21', '09:00')).toBe(
      Date.parse('2026-11-21T09:00:00+09:00'),
    );
    expect(dailyBonusSendOpensAt('2026-11-21', '21:15')).toBe(
      Date.parse('2026-11-21T21:15:00+09:00'),
    );
  });
});
