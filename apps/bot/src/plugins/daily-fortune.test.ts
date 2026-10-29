import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { savedDailyFortune } from './daily-fortune.js';
import { EMPTY_FORTUNE_PROFILE } from './fortune-core.js';
afterEach(() => vi.unstubAllEnvs());
describe('daily fortune result snapshot', () => {
  it('stores no raw or derived profile and first daily result wins', async () => {
    vi.stubEnv('DAILY_BONUS_ENABLED', 'true');
    let saved: unknown;
    const db = {
      $queryRaw: async () => (saved ? [{ result_json: saved }] : []),
      $executeRaw: async (_sql: unknown, ...values: unknown[]) => {
        saved = JSON.parse(String(values[4]));
        return 1;
      },
    } as unknown as PrismaClient;
    const first = await savedDailyFortune(db, 'guild', 'user', '2026-10-29', {
      ...EMPTY_FORTUNE_PROFILE,
      birthday: '2000-01-01',
      mbti: 'INTJ',
      bloodType: 'AB',
    });
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain('2000-01-01');
    expect(serialized).not.toContain('INTJ');
    expect(serialized).not.toContain('AB型');
    expect(first.notes).toEqual([]);
    expect(first.details).toEqual({ zodiac: null, eto: null, age: null, ageGroup: null });
    expect(first.action).toContain('一人で考えを整理してから');
    const second = await savedDailyFortune(db, 'guild', 'user', '2026-10-29', {
      ...EMPTY_FORTUNE_PROFILE,
      mbti: 'ENFP',
    });
    expect(second).toEqual(first);
    saved = undefined;
    const fresh = await savedDailyFortune(db, 'guild', 'user', '2026-10-30', {
      ...EMPTY_FORTUNE_PROFILE,
      mbti: 'ENFP',
    });
    expect(fresh.action).toContain('誰かと短く話してから');
    expect(fresh.action).toContain('試せる選択肢を一つ残して');
  });
});
