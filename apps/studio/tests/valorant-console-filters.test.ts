import { describe, expect, it } from 'vitest';
import {
  parseValorantConsoleFilters,
  matchesValorantPartySize,
  valorantPickPartySize,
  valorantConsoleHistoryQuery,
  valorantConsoleSince,
} from '../src/lib/valorant-console-filters';

describe('VALORANT console URL filter boundaries', () => {
  it('defaults to the latest 30 days and rejects unknown/injected parameters', () => {
    expect(parseValorantConsoleFilters({})).toEqual({
      period: '30',
      map: '',
      mode: '',
      partySize: '',
    });
    expect(
      parseValorantConsoleFilters({
        period: ['all'],
        map: 'Ascent OR 1=1',
        mode: 'CUSTOM',
        partySize: '4',
      }),
    ).toEqual({ period: '30', map: '', mode: '', partySize: '' });
  });

  it('accepts only exact supported map names, modes and periods', () => {
    expect(
      parseValorantConsoleFilters({ period: '90', map: 'Ascent', mode: 'RANDOM', partySize: '3' }),
    ).toEqual({
      period: '90',
      map: 'Ascent',
      mode: 'RANDOM',
      partySize: '3',
    });
    expect(parseValorantConsoleFilters({ period: 'all', mode: 'TACTICAL' })).toEqual({
      period: 'all',
      map: '',
      mode: 'TACTICAL',
      partySize: '',
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
      partySize: '5',
    });
    expect(valorantConsoleHistoryQuery(filters, 2)).toBe(
      '?period=7&map=Haven&mode=TACTICAL&partySize=5&page=2&details=1#valorant-details',
    );
  });
  it('separates 3 and 5 assigned agents without inventing missing team size', () => {
    const pick = (n: number) =>
      Array.from({ length: n }, (_, index) => ({ agentId: 'agent-' + index }));
    expect(valorantPickPartySize(pick(3))).toBe(3);
    expect(matchesValorantPartySize(pick(3), '3')).toBe(true);
    expect(matchesValorantPartySize(pick(3), '5')).toBe(false);
    expect(matchesValorantPartySize(pick(5), '5')).toBe(true);
    expect(matchesValorantPartySize(pick(5), '')).toBe(true);
    expect(matchesValorantPartySize([{ bad: 'agent' }], '3')).toBe(false);
    expect(valorantPickPartySize(null)).toBeNull();
    expect(valorantPickPartySize([])).toBeNull();
    expect(parseValorantConsoleFilters({ partySize: ['3'] }).partySize).toBe('');
    expect(parseValorantConsoleFilters({ partySize: '03' }).partySize).toBe('');
  });
});
