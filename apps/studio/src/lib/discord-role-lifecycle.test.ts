import assert from 'node:assert/strict';
import test from 'node:test';
import {
  containsDiscordRoleReference,
  lifecycleStatusLabel,
  validateDiscordRoleLifecycleCreate,
} from './discord-role-lifecycle.ts';

const NOW = new Date('2026-08-17T07:30:00.000Z');
const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

test('Role作成入力を正規化する', () => {
  const result = validateDiscordRoleLifecycleCreate(
    {
      requestId: REQUEST_ID,
      name: ' Event ',
      color: '#AA22CC',
      hoist: false,
      mentionable: true,
      createAt: null,
      expiresAt: '2026-08-18T07:30:00.000Z',
    },
    NOW,
  );
  assert.equal(result.valid, true);
  assert.equal(result.input?.name, 'Event');
  assert.equal(result.input?.color, 0xaa22cc);
  assert.equal(result.input?.expiresAt?.toISOString(), '2026-08-18T07:30:00.000Z');
});

test('過去予約・短すぎる期限・不正色を拒否する', () => {
  const result = validateDiscordRoleLifecycleCreate(
    {
      requestId: REQUEST_ID,
      name: 'Role',
      color: 'red',
      hoist: false,
      mentionable: false,
      createAt: '2026-08-17T07:20:00.000Z',
      expiresAt: '2026-08-17T07:20:30.000Z',
    },
    NOW,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('#RRGGBB')));
  assert.ok(result.errors.some((error) => error.includes('現在より後')));
  assert.ok(result.errors.some((error) => error.includes('1分以上後')));
});

test('設定JSON内のRole ID参照を再帰的に検出する', () => {
  const roleId = '123456789012345678';
  assert.equal(
    containsDiscordRoleReference({ groups: [{ roleIds: ['999', roleId] }] }, roleId),
    true,
  );
  assert.equal(containsDiscordRoleReference({ groups: [{ roleIds: ['999'] }] }, roleId), false);
});

test('lifecycle statusを管理画面向けラベルへ変換する', () => {
  assert.equal(lifecycleStatusLabel('pending'), '待機中');
  assert.equal(lifecycleStatusLabel('attention'), '要確認');
  assert.equal(lifecycleStatusLabel('unknown-value'), '不明');
});
