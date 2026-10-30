import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validDailyBonusDate,
  canOperateDailyAnnouncement,
  newDailyAnniversaryIdentity,
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
test('new anniversaries have unique IDs and require explicit source verification dates', () => {
  const a = newDailyAnniversaryIdentity(),
    b = newDailyAnniversaryIdentity();
  assert.notEqual(a.id, b.id);
  assert.equal(a.sourceCheckedAt, '');
  assert.equal(b.sourceCheckedAt, '');
  assert.ok(a.id.length <= 64);
});
