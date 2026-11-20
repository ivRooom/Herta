import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validDailyBonusDate,
  dailyBonusReferenceRate,
  canOperateDailyAnnouncement,
  composeDailyBonusPreview,
  DAILY_BONUS_DESCRIPTION_SUFFIX,
  DAILY_BONUS_FIXED_FOOTER,
  findConflictingSpecialDayRule,
  MESSAGE_TEMPLATE_MAX_LENGTH,
  parseMessageTemplateInput,
  parseSpecialDayRuleInput,
  resolveSpecialDayOverride,
  validMonthDay,
  type SpecialDayRuleView,
} from './daily-bonus-admin-input.ts';
test('anniversary fixed dates require real dates, including leap rules', () => {
  assert.equal(validDailyBonusDate('2026-02-30'), false);
  assert.equal(validDailyBonusDate('2026-02-29'), false);
  assert.equal(validDailyBonusDate('2028-02-29'), true);
  assert.equal(validDailyBonusDate('2026-10-30'), true);
});
test('delivery operation affordances expire at JST midnight and never allow past dates', () => {
  assert.equal(
    canOperateDailyAnnouncement('2026-10-30', new Date('2026-10-30T23:59:59.999+09:00')),
    true,
  );
  assert.equal(
    canOperateDailyAnnouncement('2026-10-30', new Date('2026-10-31T00:00:00+09:00')),
    false,
  );
});
test('reference rate preserves unknown and zero denominators and does not clamp membership changes', () => {
  assert.equal(dailyBonusReferenceRate(1, null), '—');
  assert.equal(dailyBonusReferenceRate(0, 0), '—');
  assert.equal(dailyBonusReferenceRate(0, 10), '0.0%');
  assert.equal(dailyBonusReferenceRate(1, 3), '33.3%');
  assert.equal(dailyBonusReferenceRate(12, 10), '120.0%');
});

const rule = (overrides: Partial<SpecialDayRuleView>): SpecialDayRuleView => ({
  id: 'r1',
  kind: 'annual',
  exact_date: null,
  month_day: '12-25',
  title: null,
  intro: null,
  enabled: true,
  ...overrides,
});

test('validMonthDay accepts real month-days including Feb 29 and rejects invalid ones', () => {
  assert.equal(validMonthDay('02-29'), true);
  assert.equal(validMonthDay('12-25'), true);
  assert.equal(validMonthDay('02-30'), false);
  assert.equal(validMonthDay('04-31'), false);
  assert.equal(validMonthDay('13-01'), false);
  assert.equal(validMonthDay('1-1'), false);
  assert.equal(validMonthDay(1225), false);
});

test('parseSpecialDayRuleInput accepts a date rule and trims text', () => {
  assert.deepEqual(
    parseSpecialDayRuleInput({
      kind: 'date',
      exactDate: '2026-12-25',
      title: '  🎄 クリスマス特別号 ',
      intro: '',
      enabled: true,
    }),
    {
      id: undefined,
      kind: 'date',
      exactDate: '2026-12-25',
      monthDay: null,
      title: '🎄 クリスマス特別号',
      intro: null,
      enabled: true,
    },
  );
});

test('parseSpecialDayRuleInput accepts an annual rule with an id', () => {
  const parsed = parseSpecialDayRuleInput({
    id: 'abc',
    kind: 'annual',
    monthDay: '01-01',
    intro: 'あけましておめでとうございます。',
    enabled: false,
  });
  assert.equal(parsed?.monthDay, '01-01');
  assert.equal(parsed?.id, 'abc');
  assert.equal(parsed?.enabled, false);
});

test('parseSpecialDayRuleInput rejects malformed inputs', () => {
  const base = { kind: 'date', exactDate: '2026-12-25', title: 'x', enabled: true };
  assert.equal(parseSpecialDayRuleInput(null), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, kind: 'weekly' }), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, exactDate: '2026-02-30' }), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, exactDate: '25-12-2026' }), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, title: ' ', intro: '' }), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, title: 'a'.repeat(257) }), null);
  assert.equal(parseSpecialDayRuleInput({ ...base, enabled: 'yes' }), null);
  assert.equal(
    parseSpecialDayRuleInput({ kind: 'annual', monthDay: '02-30', intro: 'x', enabled: true }),
    null,
  );
  assert.equal(
    parseSpecialDayRuleInput({
      kind: 'annual',
      exactDate: '2026-12-25',
      intro: 'x',
      enabled: true,
    }),
    null,
  );
});

test('resolveSpecialDayOverride prefers a date rule over an annual rule', () => {
  const rules = [
    rule({ id: 'annual', title: '年次タイトル' }),
    rule({
      id: 'date',
      kind: 'date',
      exact_date: '2026-12-25',
      month_day: null,
      intro: '個別日の冒頭',
    }),
  ];
  assert.deepEqual(resolveSpecialDayOverride(rules, '2026-12-25'), {
    title: null,
    intro: '個別日の冒頭',
    source: 'date',
  });
});

test('resolveSpecialDayOverride falls back to an annual rule when the date rule has no usable content', () => {
  const rules = [
    rule({ id: 'annual', title: '年次タイトル' }),
    rule({ id: 'date', kind: 'date', exact_date: '2026-12-25', month_day: null, title: ' ' }),
  ];
  assert.deepEqual(resolveSpecialDayOverride(rules, '2026-12-25'), {
    title: '年次タイトル',
    intro: null,
    source: 'annual',
  });
});

test('resolveSpecialDayOverride skips disabled rules and requires content', () => {
  assert.equal(
    resolveSpecialDayOverride([rule({ enabled: false, title: 'x' })], '2026-12-25'),
    null,
  );
  assert.equal(resolveSpecialDayOverride([rule({})], '2026-12-25'), null);
  assert.equal(resolveSpecialDayOverride([rule({ title: 'x' })], '2026-12-26'), null);
  assert.equal(resolveSpecialDayOverride([rule({ title: 'x' })], 'not-a-date'), null);
});

test('resolveSpecialDayOverride applies Feb 29 annual rules only in leap years', () => {
  const rules = [rule({ month_day: '02-29', title: '閏日' })];
  assert.equal(resolveSpecialDayOverride(rules, '2028-02-29')?.title, '閏日');
  assert.equal(resolveSpecialDayOverride(rules, '2026-02-28'), null);
});

test('findConflictingSpecialDayRule detects same-target rules with a different id', () => {
  const rules = [rule({ id: 'existing' })];
  const conflict = findConflictingSpecialDayRule(rules, {
    kind: 'annual',
    exactDate: null,
    monthDay: '12-25',
    title: 'new',
    intro: null,
    enabled: true,
  });
  assert.equal(conflict?.id, 'existing');
  assert.equal(
    findConflictingSpecialDayRule(rules, {
      id: 'existing',
      kind: 'annual',
      exactDate: null,
      monthDay: '12-25',
      title: 'edit',
      intro: null,
      enabled: true,
    }),
    undefined,
  );
  assert.equal(
    findConflictingSpecialDayRule(rules, {
      kind: 'annual',
      exactDate: null,
      monthDay: '12-26',
      title: 'other',
      intro: null,
      enabled: true,
    }),
    undefined,
  );
});
test('message template validation mirrors the plugin config schema', () => {
  assert.equal(parseMessageTemplateInput('おはようございます'), 'おはようございます');
  assert.equal(parseMessageTemplateInput(''), '');
  assert.equal(parseMessageTemplateInput('あ'.repeat(MESSAGE_TEMPLATE_MAX_LENGTH))?.length, 1000);
  assert.equal(parseMessageTemplateInput('あ'.repeat(MESSAGE_TEMPLATE_MAX_LENGTH + 1)), null);
  assert.equal(parseMessageTemplateInput(42), null);
  assert.equal(parseMessageTemplateInput(null), null);
});
test('composer preview composes the template with the fixed suffix and footer', () => {
  const preview = composeDailyBonusPreview({
    dateJst: '2026-11-20',
    messageTemplate: '🌅 おはようございます！',
    specialDay: null,
  });
  assert.equal(preview.title, '🎁 2026-11-20 本日のログインボーナス');
  assert.equal(preview.description, `🌅 おはようございます！\n\n${DAILY_BONUS_DESCRIPTION_SUFFIX}`);
  assert.equal(preview.footer, DAILY_BONUS_FIXED_FOOTER);
  assert.equal(preview.titleFromSpecialDay, false);
  assert.equal(preview.introFromSpecialDay, false);
});
test('composer preview lets a special-day override win over the template', () => {
  const preview = composeDailyBonusPreview({
    dateJst: '2026-12-25',
    messageTemplate: '通常の冒頭文',
    specialDay: { title: '🎄 クリスマス', intro: '特別な冒頭文', source: 'annual' },
  });
  assert.equal(preview.title, '🎄 クリスマス');
  assert.equal(preview.description, `特別な冒頭文\n\n${DAILY_BONUS_DESCRIPTION_SUFFIX}`);
  assert.equal(preview.titleFromSpecialDay, true);
  assert.equal(preview.introFromSpecialDay, true);
});
test('composer preview falls back per part when the override is partial', () => {
  const preview = composeDailyBonusPreview({
    dateJst: '2027-01-01',
    messageTemplate: '通常の冒頭文',
    specialDay: { title: '🎍 元日', intro: null, source: 'date' },
  });
  assert.equal(preview.title, '🎍 元日');
  assert.equal(preview.description, `通常の冒頭文\n\n${DAILY_BONUS_DESCRIPTION_SUFFIX}`);
  assert.equal(preview.titleFromSpecialDay, true);
  assert.equal(preview.introFromSpecialDay, false);
});
