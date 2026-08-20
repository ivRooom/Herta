import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStudioCallbackUrl } from './auth-navigation.ts';

test('DashboardとBirthday自己登録URLをOAuth callbackとして許可する', () => {
  assert.equal(normalizeStudioCallbackUrl('/dashboard'), '/dashboard');
  assert.equal(
    normalizeStudioCallbackUrl('/dashboard/guilds/111111111111111111/birthday?tab=card'),
    '/dashboard/guilds/111111111111111111/birthday?tab=card',
  );
  assert.equal(
    normalizeStudioCallbackUrl('/birthday/register/111111111111111111'),
    '/birthday/register/111111111111111111',
  );
});

test('外部URL・protocol-relative・不正なBirthday callbackをDashboardへ戻す', () => {
  assert.equal(normalizeStudioCallbackUrl('https://example.com/steal'), '/dashboard');
  assert.equal(normalizeStudioCallbackUrl('//example.com/steal'), '/dashboard');
  assert.equal(normalizeStudioCallbackUrl('/birthday/register/not-a-guild'), '/dashboard');
  assert.equal(
    normalizeStudioCallbackUrl('/birthday/register/111111111111111111/extra'),
    '/dashboard',
  );
});
