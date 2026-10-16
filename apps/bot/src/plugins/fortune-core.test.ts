import { describe, it, expect } from 'vitest';
import {
  createDailyFortune,
  describeFortuneProfile,
  EMPTY_FORTUNE_PROFILE as empty,
  localFortuneDate,
  validateFortuneProfile,
  zodiacForBirthday,
} from './fortune-core.js';

describe('daily fortune', () => {
  it('uses the guild date across midnight and daylight saving', () => {
    expect(localFortuneDate(new Date('2026-10-15T15:00:00Z'), 'Asia/Tokyo')).toBe('2026-10-16');
    expect(localFortuneDate(new Date('2026-10-15T15:00:00Z'), 'America/New_York')).toBe(
      '2026-10-15',
    );
  });
  it('handles zodiac cutoffs, leap dates, age and Japanese calendar-year eto', () => {
    expect(zodiacForBirthday(1, 19)).toBe('山羊座');
    expect(zodiacForBirthday(1, 20)).toBe('水瓶座');
    expect(zodiacForBirthday(3, 20)).toBe('魚座');
    expect(zodiacForBirthday(3, 21)).toBe('牡羊座');
    expect(() =>
      validateFortuneProfile({ ...empty, birthday: '02-29' }, '2026-10-16'),
    ).not.toThrow();
    for (const birthday of [
      '2023-02-29',
      '13-01',
      '2027-01-01',
      '1900-02-29',
      '1899-01-01',
      '<script>',
    ])
      expect(() => validateFortuneProfile({ ...empty, birthday }, '2026-10-16')).toThrow();
    const p = { ...empty, birthday: '2000-10-17' };
    expect(describeFortuneProfile(p, '2026-10-16')).toMatchObject({
      age: 25,
      ageGroup: '20代',
      eto: '辰',
      zodiac: '天秤座',
    });
    expect(describeFortuneProfile(p, '2026-10-17').age).toBe(26);
    expect(describeFortuneProfile({ ...empty, birthday: '10-17' }, '2026-10-16').age).toBeNull();
  });
  it('rejects contradictory and malformed profiles', () => {
    for (const extra of [
      { mbti: 'INFP-X' },
      { bloodType: 'C' },
      { birthday: '2000-10-17', zodiac: '不明座' },
      { birthday: '2000-10-17', eto: '猫' },
      { birthday: '2000-10-17', ageGroup: '40代' },
    ])
      expect(() => validateFortuneProfile({ ...empty, ...extra }, '2026-10-16')).toThrow();
  });
  it('respects explicit zodiac and eto overrides', () => {
    const profile = { ...empty, birthday: '2000-10-17', zodiac: '牡羊座', eto: '子' };
    expect(() => validateFortuneProfile(profile, '2026-10-17')).not.toThrow();
    expect(describeFortuneProfile(profile, '2026-10-17')).toMatchObject({
      zodiac: '牡羊座',
      eto: '子',
      age: 26,
    });
  });
  it('does not reroll for profile edits, separates users/days and provides complete bounded results', () => {
    const a = createDailyFortune('guild', 'user', '2026-10-16', empty);
    expect(createDailyFortune('guild', 'user', '2026-10-16', empty)).toEqual(a);
    const p = createDailyFortune('guild', 'user', '2026-10-16', {
      ...empty,
      birthday: '2000-10-16',
      mbti: 'INFP-T',
      bloodType: 'AB',
    });
    expect(p.stars).toBe(a.stars);
    expect(p.categories).toEqual(a.categories);
    expect(p.hex).toBe(a.hex);
    expect(p.notes.join('')).toContain('お誕生日');
    const draws = Array.from({ length: 100 }, (_, i) =>
      createDailyFortune('guild', `user${i}`, '2026-10-16', empty),
    );
    expect(
      new Set(draws.map((d) => JSON.stringify([d.title, d.stars, d.categories]))).size,
    ).toBeGreaterThan(90);
    expect(
      draws.every(
        (d) =>
          d.categories.every((c) => c.stars >= 1 && c.stars <= 5) &&
          d.action &&
          d.item &&
          /^#[a-f0-9]{6}$/.test(d.hex),
      ),
    ).toBe(true);
    expect(createDailyFortune('guild', 'user', '2026-10-17', empty)).not.toEqual(a);
  });
});
