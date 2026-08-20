import assert from 'node:assert/strict';
import test from 'node:test';
import {
  birthdaySelfRegistrationEligibility,
  parseBirthdaySelfRegistrationRequest,
} from './birthday-self-registration-core.ts';

const USER_ID = '111111111111111111';
const MEMBER_ROLE_ID = '222222222222222222';

test('Birthday自己登録payloadを正規化する', () => {
  assert.deepEqual(
    parseBirthdaySelfRegistrationRequest({ month: '8', day: '19', birthYear: '' }, 2026),
    { month: 8, day: 19, birthYear: null },
  );
  assert.deepEqual(
    parseBirthdaySelfRegistrationRequest({ month: 2, day: 29, birthYear: '2000' }, 2026),
    { month: 2, day: 29, birthYear: 2000 },
  );
});

test('Birthday自己登録payloadの不正日付・未来年を拒否する', () => {
  assert.equal(
    parseBirthdaySelfRegistrationRequest({ month: 2, day: 30, birthYear: 2000 }, 2026),
    null,
  );
  assert.equal(
    parseBirthdaySelfRegistrationRequest({ month: 8, day: 19, birthYear: 2027 }, 2026),
    null,
  );
});

test('非空の不正birthYearを未入力として扱わず拒否する', () => {
  for (const birthYear of ['invalid', '-5', 2000.5, Number.NaN]) {
    assert.equal(
      parseBirthdaySelfRegistrationRequest({ month: 8, day: 19, birthYear }, 2026),
      null,
    );
  }
  assert.deepEqual(
    parseBirthdaySelfRegistrationRequest({ month: 8, day: 19, birthYear: '   ' }, 2026),
    { month: 8, day: 19, birthYear: null },
  );
});

test('現在GuildのMemberロール保有ユーザーだけを許可する', () => {
  const roles = [
    { id: MEMBER_ROLE_ID, name: 'Member' },
    { id: '333333333333333333', name: 'Moderator' },
  ];
  assert.equal(
    birthdaySelfRegistrationEligibility(
      USER_ID,
      { id: USER_ID, bot: false, roleIds: [MEMBER_ROLE_ID] },
      roles,
    ),
    'eligible',
  );
  assert.equal(birthdaySelfRegistrationEligibility(USER_ID, null, roles), 'not-member');
  assert.equal(
    birthdaySelfRegistrationEligibility(
      USER_ID,
      { id: USER_ID, bot: true, roleIds: [MEMBER_ROLE_ID] },
      roles,
    ),
    'bot',
  );
  assert.equal(
    birthdaySelfRegistrationEligibility(
      USER_ID,
      { id: USER_ID, bot: false, roleIds: ['333333333333333333'] },
      roles,
    ),
    'member-role-missing',
  );
});

test('Memberロール名は完全一致し、ロール定義がない場合もfail closedする', () => {
  assert.equal(
    birthdaySelfRegistrationEligibility(
      USER_ID,
      { id: USER_ID, bot: false, roleIds: [MEMBER_ROLE_ID] },
      [{ id: MEMBER_ROLE_ID, name: 'member' }],
    ),
    'member-role-missing',
  );
  assert.equal(
    birthdaySelfRegistrationEligibility(
      USER_ID,
      { id: USER_ID, bot: false, roleIds: [MEMBER_ROLE_ID] },
      [],
    ),
    'member-role-missing',
  );
});
