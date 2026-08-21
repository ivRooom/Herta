import assert from 'node:assert/strict';
import test from 'node:test';
import {
  birthdaySelfRegistrationEligibility,
  birthdaySelfRegistrationEnabled,
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

test('現在Guildの非Botメンバーは事前登録なしで自己登録できる', () => {
  assert.equal(
    birthdaySelfRegistrationEligibility(USER_ID, { id: USER_ID, bot: false }),
    'eligible',
  );
});

test('Guild未所属・別ユーザー・Botは自己登録できない', () => {
  assert.equal(birthdaySelfRegistrationEligibility(USER_ID, null), 'not-member');
  assert.equal(
    birthdaySelfRegistrationEligibility(USER_ID, {
      id: '222222222222222222',
      bot: false,
    }),
    'not-member',
  );
  assert.equal(birthdaySelfRegistrationEligibility(USER_ID, { id: USER_ID, bot: true }), 'bot');
});

test('本人登録はBirthday pluginが有効かつallowSelfRegistrationが許可されている時だけ有効', () => {
  assert.equal(
    birthdaySelfRegistrationEnabled({ installed: true, enabled: true, config: {} }),
    true,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({
      installed: true,
      enabled: true,
      config: { enabled: true, allowSelfRegistration: true },
    }),
    true,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({
      installed: true,
      enabled: true,
      config: { enabled: false, allowSelfRegistration: true },
    }),
    false,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({
      installed: true,
      enabled: true,
      config: { enabled: 'false', allowSelfRegistration: true },
    }),
    false,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({
      installed: true,
      enabled: true,
      config: { allowSelfRegistration: false },
    }),
    false,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({
      installed: true,
      enabled: true,
      config: { allowSelfRegistration: 'false' },
    }),
    false,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({ installed: false, enabled: true, config: {} }),
    false,
  );
  assert.equal(
    birthdaySelfRegistrationEnabled({ installed: true, enabled: false, config: {} }),
    false,
  );
});
