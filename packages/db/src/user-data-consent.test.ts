import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAutoConsentRoles } from './user-data-consent.js';

test('自動同意ロール未設定時はベースの同意状態をそのまま返す', () => {
  const result = applyAutoConsentRoles(
    new Map([['user-1', false]]),
    ['user-1'],
    [],
    new Map([['user-1', ['role-a']]]),
  );
  assert.equal(result.get('user-1'), false);
});

test('自動同意ロールを持つユーザーは未同意でもtrueになる', () => {
  const result = applyAutoConsentRoles(
    new Map([['user-1', false]]),
    ['user-1'],
    ['role-auto'],
    new Map([['user-1', ['role-a', 'role-auto']]]),
  );
  assert.equal(result.get('user-1'), true);
});

test('自動同意ロールを持たないユーザーはベースの同意状態が維持される', () => {
  const result = applyAutoConsentRoles(
    new Map([
      ['user-1', true],
      ['user-2', false],
    ]),
    ['user-1', 'user-2'],
    ['role-auto'],
    new Map([
      ['user-1', ['role-auto']],
      ['user-2', ['role-a']],
    ]),
  );
  assert.equal(result.get('user-1'), true);
  assert.equal(result.get('user-2'), false);
});

test('roleIdsByUserに未登録のユーザーは空配列扱いになる', () => {
  const result = applyAutoConsentRoles(new Map(), ['user-1'], ['role-auto'], new Map());
  assert.equal(result.get('user-1'), false);
});
