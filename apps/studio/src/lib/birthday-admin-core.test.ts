import assert from 'node:assert/strict';
import test from 'node:test';
import {
  daysInBirthdayMonth,
  isValidBirthdayDate,
  parseBirthdayAdminRequest,
} from './birthday-admin-core.ts';

const USER_ID = '123456789012345678';

test('Birthday setは月日を正規化し2月29日を受け入れる', () => {
  assert.deepEqual(
    parseBirthdayAdminRequest({ action: 'set', userId: USER_ID, month: '2', day: '29' }),
    { action: 'set', userId: USER_ID, month: 2, day: 29 },
  );
  assert.equal(daysInBirthdayMonth(2), 29);
  assert.equal(isValidBirthdayDate(2, 29), true);
});

test('存在しない月日と不正Discord IDを拒否する', () => {
  assert.equal(parseBirthdayAdminRequest({ action: 'set', userId: USER_ID, month: 2, day: 30 }), null);
  assert.equal(parseBirthdayAdminRequest({ action: 'set', userId: USER_ID, month: 4, day: 31 }), null);
  assert.equal(parseBirthdayAdminRequest({ action: 'set', userId: 'invalid', month: 1, day: 1 }), null);
});

test('Birthday removeは月日を要求しない', () => {
  assert.deepEqual(parseBirthdayAdminRequest({ action: 'remove', userId: USER_ID }), {
    action: 'remove',
    userId: USER_ID,
    month: null,
    day: null,
  });
});
