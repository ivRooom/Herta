import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISCORD_ROLE_EXPIRY_MAX_SECONDS,
  DISCORD_ROLE_EXPIRY_MIN_SECONDS,
  formatDiscordRoleColor,
  isRoleOperationId,
  parseDiscordRoleCreateRequest,
  roleDeleteBlockReason,
} from './discord-role-lifecycle.ts';

const NOW = new Date('2026-08-17T08:00:00.000Z');
const ROOT_ROLE_ID = '1069969919271252018';

test('即時Role作成入力をtrimしHEX colorを数値へ変換する', () => {
  const parsed = parseDiscordRoleCreateRequest(
    {
      name: '  Event Staff  ',
      color: '#5865F2',
      scheduledFor: null,
      expiresAfterSeconds: null,
    },
    NOW,
  );

  assert.ok(parsed);
  assert.equal(parsed.name, 'Event Staff');
  assert.equal(parsed.color, 0x5865f2);
  assert.equal(parsed.scheduledFor.toISOString(), NOW.toISOString());
  assert.equal(parsed.expiresAfterSeconds, null);
  assert.equal(formatDiscordRoleColor(parsed.color), '#5865F2');
});

test('権限などRole Lifecycle APIが管理しない未知フィールドを拒否する', () => {
  assert.equal(
    parseDiscordRoleCreateRequest(
      {
        name: 'Admin',
        color: '#FF0000',
        permissions: '8',
      },
      NOW,
    ),
    null,
  );
});

test('予約日時は1年以内の未来だけ受け付ける', () => {
  const valid = parseDiscordRoleCreateRequest(
    {
      name: 'Scheduled',
      color: '#000000',
      scheduledFor: '2026-09-01T00:00:00.000Z',
    },
    NOW,
  );
  assert.ok(valid);
  assert.equal(valid.scheduledFor.toISOString(), '2026-09-01T00:00:00.000Z');

  assert.equal(
    parseDiscordRoleCreateRequest(
      {
        name: 'Too old',
        color: '#000000',
        scheduledFor: '2026-08-17T07:59:00.000Z',
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDiscordRoleCreateRequest(
      {
        name: 'Too far',
        color: '#000000',
        scheduledFor: '2027-08-18T08:00:00.000Z',
      },
      NOW,
    ),
    null,
  );
});

test('一時Role TTLの境界値を検証する', () => {
  for (const expiresAfterSeconds of [
    DISCORD_ROLE_EXPIRY_MIN_SECONDS,
    DISCORD_ROLE_EXPIRY_MAX_SECONDS,
  ]) {
    const parsed = parseDiscordRoleCreateRequest(
      { name: 'Temporary', color: '#123456', expiresAfterSeconds },
      NOW,
    );
    assert.equal(parsed?.expiresAfterSeconds, expiresAfterSeconds);
  }

  assert.equal(
    parseDiscordRoleCreateRequest(
      { name: 'Too short', color: '#123456', expiresAfterSeconds: 59 },
      NOW,
    ),
    null,
  );
  assert.equal(
    parseDiscordRoleCreateRequest(
      {
        name: 'Too long',
        color: '#123456',
        expiresAfterSeconds: DISCORD_ROLE_EXPIRY_MAX_SECONDS + 1,
      },
      NOW,
    ),
    null,
  );
});

test('Role作成Idempotency-KeyはUUIDだけを受け付ける', () => {
  assert.equal(isRoleOperationId('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isRoleOperationId('123456789012345678'), false);
  assert.equal(isRoleOperationId('not-a-uuid'), false);
});

test('削除不可理由をroot・managed・hierarchyの順に判定する', () => {
  assert.equal(
    roleDeleteBlockReason({ id: ROOT_ROLE_ID, managed: false, editable: true }, ROOT_ROLE_ID),
    'root',
  );
  assert.equal(
    roleDeleteBlockReason(
      { id: '200000000000000001', managed: true, editable: true },
      ROOT_ROLE_ID,
    ),
    'managed',
  );
  assert.equal(
    roleDeleteBlockReason(
      { id: '200000000000000002', managed: false, editable: false },
      ROOT_ROLE_ID,
    ),
    'hierarchy',
  );
  assert.equal(
    roleDeleteBlockReason(
      { id: '200000000000000003', managed: false, editable: true },
      ROOT_ROLE_ID,
    ),
    null,
  );
});
