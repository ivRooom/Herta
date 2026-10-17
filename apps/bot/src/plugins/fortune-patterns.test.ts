import { describe, it, expect } from 'vitest';
import {
  dailyFortunePattern,
  fortunePatternAt,
  FORTUNE_PATTERN_COUNT,
} from './fortune-patterns.js';

describe('fortune editorial library', () => {
  it('contains at least 1,000 distinct complete text combinations fitting the card', () => {
    expect(FORTUNE_PATTERN_COUNT).toBe(1024);
    const patterns = Array.from({ length: FORTUNE_PATTERN_COUNT }, (_, i) => fortunePatternAt(i));
    expect(new Set(patterns.map((p) => p.message)).size).toBe(1024);
    expect(new Set(patterns.map((p) => p.title)).size).toBe(1024);
    expect(
      patterns.every(
        (p) =>
          p.title.length <= 29 &&
          p.message.length <= 105 &&
          p.action.length <= 36 &&
          /^#[a-f0-9]{6}$/.test(p.hex),
      ),
    ).toBe(true);
  });
  it('cycles every pattern exactly once over 1,024 days, without profile-dependent rerolls', () => {
    for (const subject of ['one', 'two', 'three']) {
      const patterns = Array.from({ length: 1024 }, (_, i) =>
        dailyFortunePattern(
          'guild',
          subject,
          new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
        ),
      );
      expect(new Set(patterns.map((p) => p.patternId)).size).toBe(1024);
      expect(dailyFortunePattern('guild', subject, '2026-01-01')).toEqual(patterns[0]);
    }
    expect(() => dailyFortunePattern('g', 'u', '2026-02-30')).toThrow();
  });
});
