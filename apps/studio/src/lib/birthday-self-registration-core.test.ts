import assert from 'node:assert/strict';
import test from 'node:test';
import {
  birthdaySelfRegistrationEligibility,
  isBirthdaySelfRegistrationAllowed,
  parseBirthdaySelfRegistrationRequest,
} from './birthday-self-registration-core.ts';

const USER_ID = '111111111111111111';

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

test('現在Guildに所属する非Botユーザーを初回登録でも許可する', () => {
  assert.equal(
    birthdaySelfRegistrationEligibility(USER_ID, { id: USER_ID, bot: false }),
    'eligible',
  );
  assert.equal(birthdaySelfRegistrationEligibility(USER_ID, null), 'not-member');
  assert.equal(birthdaySelfRegistrationEligibility(USER_ID, { id: USER_ID, bot: true }), 'bot');
  assert.equal(
    birthdaySelfRegistrationEligibility(USER_ID, { id: '222222222222222222', bot: false }),
    'not-member',
  );
});

test('本人登録設定は既定ONで、明示的なOFFを尊重する', () => {
  assert.equal(isBirthdaySelfRegistrationAllowed({}), true);
  assert.equal(isBirthdaySelfRegistrationAllowed({ allowSelfRegistration: true }), true);
  assert.equal(isBirthdaySelfRegistrationAllowed({ allowSelfRegistration: false }), false);
  assert.equal(isBirthdaySelfRegistrationAllowed({ allowSelfRegistration: 'true' }), false);
});
