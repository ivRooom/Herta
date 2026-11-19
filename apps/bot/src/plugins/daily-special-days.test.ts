import { describe, it, expect } from 'vitest';
import type { DailySpecialDayRuleRow } from '@herta/db';
import { resolveSpecialDayOverride } from './daily-special-days.js';

function rule(partial: Partial<DailySpecialDayRuleRow>): DailySpecialDayRuleRow {
  return {
    id: 'rule-1',
    guild_id: '964326043420872704',
    kind: 'annual',
    exact_date: null,
    month_day: '10-31',
    title: '🎃 Happy Halloween!',
    intro: 'ハッピーハロウィン！',
    enabled: true,
    created_by: 'test',
    created_at: new Date(0),
    updated_at: new Date(0),
    ...partial,
  };
}

describe('special-day resolution', () => {
  it('applies an annual rule on its month-day and nothing on other days', () => {
    const rules = [rule({})];
    expect(resolveSpecialDayOverride(rules, '2026-10-31')).toEqual({
      ruleId: 'rule-1',
      kind: 'annual',
      title: '🎃 Happy Halloween!',
      intro: 'ハッピーハロウィン！',
    });
    expect(resolveSpecialDayOverride(rules, '2026-10-30')).toBeNull();
    expect(resolveSpecialDayOverride(rules, '2027-10-31')?.ruleId).toBe('rule-1');
  });
  it('prefers an exact-date rule over an annual rule for the same day', () => {
    const rules = [
      rule({}),
      rule({
        id: 'rule-2',
        kind: 'date',
        exact_date: '2026-10-31',
        month_day: null,
        title: '🎃 2026だけのハロウィン',
        intro: null,
      }),
    ];
    const resolved = resolveSpecialDayOverride(rules, '2026-10-31');
    expect(resolved?.ruleId).toBe('rule-2');
    expect(resolved?.title).toBe('🎃 2026だけのハロウィン');
    expect(resolved?.intro).toBeNull();
    expect(resolveSpecialDayOverride(rules, '2027-10-31')?.ruleId).toBe('rule-1');
  });
  it('ignores disabled rules and rules with no usable text', () => {
    expect(resolveSpecialDayOverride([rule({ enabled: false })], '2026-10-31')).toBeNull();
    expect(
      resolveSpecialDayOverride([rule({ title: '  ', intro: null })], '2026-10-31'),
    ).toBeNull();
  });
  it('matches an annual 02-29 rule only when the date exists', () => {
    const rules = [rule({ month_day: '02-29', title: 'うるう日', intro: null })];
    expect(resolveSpecialDayOverride(rules, '2028-02-29')?.title).toBe('うるう日');
    expect(resolveSpecialDayOverride(rules, '2026-02-28')).toBeNull();
    expect(resolveSpecialDayOverride(rules, '2026-03-01')).toBeNull();
  });
  it('supports title-only and intro-only overrides and rejects bad dates', () => {
    const introOnly = [rule({ title: null, intro: '本文だけ差替' })];
    expect(resolveSpecialDayOverride(introOnly, '2026-10-31')).toEqual({
      ruleId: 'rule-1',
      kind: 'annual',
      title: null,
      intro: '本文だけ差替',
    });
    expect(resolveSpecialDayOverride([rule({})], '10-31')).toBeNull();
    expect(resolveSpecialDayOverride([rule({})], '2026/10/31')).toBeNull();
  });
});
