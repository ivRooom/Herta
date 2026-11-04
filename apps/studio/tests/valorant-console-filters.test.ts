import { describe, expect, it } from 'vitest';
import {
  parseValorantConsoleFilters,
  valorantConsoleHistoryQuery,
  valorantConsoleSince,
} from '../src/lib/valorant-console-filters';

describe('VALORANT console URL filter boundaries', () => {
  it('defaults to the latest 30 days and rejects unknown/injected parameters', () => {
    expect(parseValorantConsoleFilters({})).toEqual({ period: '30', map: '', mode: '' });
    expect(
      parseValorantConsoleFilters({
        period: ['all'],
        map: 'Ascent OR 1=1',
        mode: 'CUSTOM',
      }),
    ).toEqual({ period: '30', map: '', mode: '' });
  });

  it('accepts only exact supported map names, modes and periods', () => {
    expect(parseValorantConsoleFilters({ period: '90', map: 'Ascent', mode: 'RANDOM' })).toEqual({
      period: '90',
      map: 'Ascent',
      mode: 'RANDOM',
    });
    expect(parseValorantConsoleFilters({ period: 'all', mode: 'TACTICAL' })).toEqual({
      period: 'all',
      map: '',
      mode: 'TACTICAL',
    });
  });

  it('calculates a stable rolling UTC cutoff, not a local-calendar midnight', () => {
    const now = new Date('2026-11-04T02:30:00.000Z');
    expect(valorantConsoleSince('7', now)?.toISOString()).toBe('2026-10-28T02:30:00.000Z');
    expect(valorantConsoleSince('30', now)?.toISOString()).toBe('2026-10-05T02:30:00.000Z');
    expect(valorantConsoleSince('all', now)).toBeNull();
  });

  it('preserves every selected filter when paginating history', () => {
    const filters = parseValorantConsoleFilters({
      period: '7',
      map: 'Haven',
      mode: 'TACTICAL',
    });
    expect(valorantConsoleHistoryQuery(filters, 2)).toBe(
      '?period=7&map=Haven&mode=TACTICAL&page=2&details=1#valorant-details',
    );
  });
});
