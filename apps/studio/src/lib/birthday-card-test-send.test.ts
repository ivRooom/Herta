import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBirthdayCardTestUserId } from './birthday-card-test-send.ts';

test('test-send userIdは未選択を許可する', () => {
  assert.deepEqual(parseBirthdayCardTestUserId(null), { ok: true, userId: null });
  assert.deepEqual(parseBirthdayCardTestUserId(''), { ok: true, userId: null });
  assert.deepEqual(parseBirthdayCardTestUserId('   '), { ok: true, userId: null });
});

test('test-send userIdはDiscord snowflakeだけを受け入れる', () => {
  assert.deepEqual(parseBirthdayCardTestUserId(' 123456789012345678 '), {
    ok: true,
    userId: '123456789012345678',
  });
  assert.deepEqual(parseBirthdayCardTestUserId('invalid'), { ok: false });
  assert.deepEqual(parseBirthdayCardTestUserId(123), { ok: false });
});
