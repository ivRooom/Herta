import assert from 'node:assert/strict';
import test from 'node:test';
import {
  birthdayMemberEligibility,
  buildBirthdayCsv,
  daysInBirthdayMonth,
  filterBirthdayRegistrations,
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
  assert.equal(
    parseBirthdayAdminRequest({ action: 'set', userId: USER_ID, month: 2, day: 30 }),
    null,
  );
  assert.equal(
    parseBirthdayAdminRequest({ action: 'set', userId: USER_ID, month: 4, day: 31 }),
    null,
  );
  assert.equal(
    parseBirthdayAdminRequest({ action: 'set', userId: 'invalid', month: 1, day: 1 }),
    null,
  );
});

test('Birthday removeは月日を要求しない', () => {
  assert.deepEqual(parseBirthdayAdminRequest({ action: 'remove', userId: USER_ID }), {
    action: 'remove',
    userId: USER_ID,
    month: null,
    day: null,
  });
});

test('Birthday対象はGuild所属の人間メンバーだけを許可する', () => {
  assert.equal(birthdayMemberEligibility(USER_ID, [{ id: USER_ID, bot: false }]), 'eligible');
  assert.equal(birthdayMemberEligibility(USER_ID, [{ id: USER_ID, bot: true }]), 'bot');
  assert.equal(
    birthdayMemberEligibility(USER_ID, [{ id: '987654321098765432', bot: false }]),
    'not-found',
  );
});

test('Birthday一覧は月日順に並べて月・Discord IDで絞り込める', () => {
  const registrations = [
    { userId: '333333333333333333', month: 12, day: 1 },
    { userId: '222222222222222222', month: 2, day: 14 },
    { userId: '111111111111111111', month: 2, day: 3 },
  ];

  assert.deepEqual(
    filterBirthdayRegistrations(registrations, '', null).map((item) => item.userId),
    ['111111111111111111', '222222222222222222', '333333333333333333'],
  );
  assert.deepEqual(
    filterBirthdayRegistrations(registrations, '', 2).map((item) => item.userId),
    ['111111111111111111', '222222222222222222'],
  );
  assert.deepEqual(
    filterBirthdayRegistrations(registrations, '333333', null).map((item) => item.userId),
    ['333333333333333333'],
  );
});

test('Birthday CSVは生年を含めずDiscord ID・月・日のみ出力する', () => {
  assert.equal(
    buildBirthdayCsv([
      { userId: '333333333333333333', month: 12, day: 1 },
      { userId: '111111111111111111', month: 2, day: 3 },
    ]),
    [
      'discord_user_id,month,day',
      '111111111111111111,2,3',
      '333333333333333333,12,1',
    ].join('\n'),
  );
});
