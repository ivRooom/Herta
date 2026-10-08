import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IVRM_IAM_BATCH_BODY_MAX_BYTES,
  IVRM_IAM_BATCH_MAX_ITEMS,
  IVRM_IAM_CAPABILITIES,
  checkAttachPrincipals,
  createFixedWindowRateLimiter,
  findMissingGuildMembers,
  mapWithConcurrency,
  parseAttachmentBatch,
  parseExpectedUpdatedAt,
  parseGroupDeleteOptions,
  parseGroupUpdateBody,
  parseMemberBatch,
  parsePrincipal,
  parseUuid,
  readRateLimitPerMinute,
} from './ivrm-iam-management.ts';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from './studio-access-policy.ts';

const USER = '444444444444444444';
const USER_2 = '555555555555555555';
const ROLE = '666666666666666666';
const GROUP = '3f6c1a52-8e63-4a53-9d2f-0c1b6f8a7e10';

test('capabilitiesは契約v1.1.0の6つ', () => {
  assert.deepEqual(
    [...IVRM_IAM_CAPABILITIES],
    [
      'group.update',
      'group.delete',
      'group.member',
      'group.member.batch',
      'policy.attach',
      'policy.attach.batch',
    ],
  );
});

test('UUIDは小文字へ正規化し、principalは種別ごとの形式を検証する', () => {
  assert.equal(parseUuid(GROUP.toUpperCase()), GROUP);
  assert.equal(parseUuid('not-a-uuid'), null);
  assert.deepEqual(parsePrincipal('user', USER), { type: 'user', id: USER });
  assert.deepEqual(parsePrincipal('role', ROLE), { type: 'role', id: ROLE });
  assert.deepEqual(parsePrincipal('group', GROUP.toUpperCase()), { type: 'group', id: GROUP });
  assert.equal(parsePrincipal('group', USER), null);
  assert.equal(parsePrincipal('user', GROUP), null);
  assert.equal(parsePrincipal('plugin', USER), null);
});

test('expectedUpdatedAtはタイムゾーン付きのRFC3339だけを受け付ける', () => {
  assert.ok(parseExpectedUpdatedAt('2026-10-08T12:00:00.123Z'));
  assert.ok(parseExpectedUpdatedAt('2026-10-08T21:00:00+09:00'));
  assert.equal(parseExpectedUpdatedAt('2026-10-08T12:00:00'), null);
  assert.equal(parseExpectedUpdatedAt('2026-13-40T12:00:00Z'), null);
  assert.equal(parseExpectedUpdatedAt(undefined), null);
});

test('グループ編集の本文はname/description/expectedUpdatedAtを検証する', () => {
  const ok = parseGroupUpdateBody({
    name: '  Moderators ',
    description: '',
    expectedUpdatedAt: '2026-10-08T12:00:00.000Z',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.name, 'Moderators');
    assert.equal(ok.value.description, null);
  }
  assert.equal(parseGroupUpdateBody({ name: 'A' }).ok, false);
  assert.equal(
    parseGroupUpdateBody({ name: '', expectedUpdatedAt: '2026-10-08T12:00:00Z' }).ok,
    false,
  );
  assert.equal(parseGroupUpdateBody(null).ok, false);
});

test('グループ削除のクエリ: cascadeとmembersLimitの既定と許可値', () => {
  const base = 'expectedUpdatedAt=2026-10-08T12:00:00.000Z';
  const defaults = parseGroupDeleteOptions(new URLSearchParams(base));
  assert.equal(defaults.ok && defaults.value.cascade, false);
  assert.equal(defaults.ok && defaults.value.membersLimit, 50);

  for (const limit of [25, 50, 100, 500, 1000]) {
    const parsed = parseGroupDeleteOptions(
      new URLSearchParams(`${base}&membersLimit=${limit}&cascade=true`),
    );
    assert.equal(parsed.ok && parsed.value.membersLimit, limit);
    assert.equal(parsed.ok && parsed.value.cascade, true);
  }
  for (const bad of ['membersLimit=10', 'membersLimit=abc', 'cascade=yes']) {
    assert.equal(parseGroupDeleteOptions(new URLSearchParams(`${base}&${bad}`)).ok, false);
  }
  assert.equal(parseGroupDeleteOptions(new URLSearchParams('cascade=true')).ok, false);
});

test('メンバー一括: 重複を除き、元のリクエスト上の位置を保つ', () => {
  const parsed = parseMemberBatch({ add: [USER, USER, USER_2], remove: [ROLE] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.add, [USER, USER_2]);
  assert.deepEqual(parsed.value.addIndexes, [0, 2]);
  assert.deepEqual(parsed.value.remove, [ROLE]);
});

test('メンバー一括: 不正なIDと、add/removeの重複を要素ごとのエラーにする', () => {
  const parsed = parseMemberBatch({ add: [USER, 'oops', USER_2], remove: [USER_2, 123] });
  assert.equal(parsed.ok, false);
  if (parsed.ok || parsed.kind !== 'items') return;
  assert.deepEqual(parsed.itemErrors, [
    { list: 'add', index: 1, code: 'invalid_id' },
    { list: 'remove', index: 1, code: 'invalid_id' },
    { list: 'remove', index: 0, code: 'duplicate_in_both_lists' },
  ]);
});

test('一括は1〜500件。空・超過・形式不正は全体エラー', () => {
  assert.equal(parseMemberBatch({}).ok, false);
  assert.equal(parseMemberBatch({ add: [] }).ok, false);
  assert.equal(parseMemberBatch({ add: 'x' }).ok, false);
  assert.equal(parseMemberBatch([]).ok, false);

  const ids = Array.from({ length: IVRM_IAM_BATCH_MAX_ITEMS }, (_, index) =>
    String(400_000_000_000_000_000n + BigInt(index)),
  );
  assert.equal(parseMemberBatch({ add: ids }).ok, true);
  assert.equal(parseMemberBatch({ add: [...ids, USER] }).ok, false);
  assert.equal(parseMemberBatch({ add: ids.slice(0, 300), remove: ids.slice(300) }).ok, true);
  assert.equal(
    parseMemberBatch({ add: ids.slice(0, 300), remove: [...ids.slice(300), USER] }).ok,
    false,
  );
});

test('割り当て一括: principalの形式・重複・位置を検証する', () => {
  const parsed = parseAttachmentBatch({
    attach: [
      { type: 'user', id: USER },
      { type: 'user', id: USER },
      { type: 'group', id: GROUP.toUpperCase() },
    ],
    detach: [{ type: 'role', id: ROLE }],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value.attach, [
      { type: 'user', id: USER },
      { type: 'group', id: GROUP },
    ]);
    assert.deepEqual(parsed.value.attachIndexes, [0, 2]);
  }

  const bad = parseAttachmentBatch({
    attach: [{ type: 'user', id: USER }, { type: 'group', id: USER }, 'x'],
    detach: [{ type: 'user', id: USER }],
  });
  assert.equal(bad.ok, false);
  if (bad.ok || bad.kind !== 'items') return;
  assert.deepEqual(bad.itemErrors, [
    { list: 'attach', index: 1, code: 'invalid_id' },
    { list: 'attach', index: 2, code: 'invalid_id' },
    { list: 'detach', index: 0, code: 'duplicate_in_both_lists' },
  ]);
});

test('mapWithConcurrencyは同時実行数を守り、結果の順序を保つ', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithConcurrency(
    Array.from({ length: 20 }, (_, index) => index),
    4,
    async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
      return value * 2;
    },
  );
  assert.deepEqual(
    results,
    Array.from({ length: 20 }, (_, index) => index * 2),
  );
  assert.ok(peak <= 4, `peak concurrency ${peak}`);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test('割り当て対象の存在確認: rootロール・存在しないrole/group/userを要素ごとに報告する', async () => {
  const ports = {
    getRoleIds: async () => new Set([ROLE]),
    hasGuildMember: async (userId: string) => userId === USER,
    groupIds: async () => new Set([GROUP]),
  };
  const result = await checkAttachPrincipals(
    [
      { type: 'role', id: STUDIO_ROOT_DISCORD_ROLE_ID },
      { type: 'role', id: ROLE },
      { type: 'role', id: '777777777777777777' },
      { type: 'group', id: GROUP },
      { type: 'group', id: '11111111-1111-4111-8111-111111111111' },
      { type: 'user', id: USER },
      { type: 'user', id: USER_2 },
    ],
    ports,
  );
  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.deepEqual(result.errors, [
    { index: 0, code: 'root_role_not_allowed' },
    { index: 2, code: 'role_not_found' },
    { index: 4, code: 'group_not_found' },
    { index: 6, code: 'not_a_guild_member' },
  ]);

  assert.deepEqual(await checkAttachPrincipals([{ type: 'user', id: USER }], ports), {
    status: 'ok',
  });
});

test('ロール一覧を取得できなければ unavailable(503)。roleを含まなければロール一覧を取得しない', async () => {
  let roleCalls = 0;
  const ports = {
    getRoleIds: async () => {
      roleCalls += 1;
      return null;
    },
    hasGuildMember: async () => true,
    groupIds: async () => new Set<string>(),
  };
  assert.deepEqual(await checkAttachPrincipals([{ type: 'role', id: ROLE }], ports), {
    status: 'unavailable',
  });
  assert.deepEqual(await checkAttachPrincipals([{ type: 'user', id: USER }], ports), {
    status: 'ok',
  });
  assert.equal(roleCalls, 1);
});

test('追加対象のギルドメンバー確認は、存在しない要素の位置を返す', async () => {
  const missing = await findMissingGuildMembers([USER, USER_2, ROLE], async (id) => id === USER);
  assert.deepEqual(missing, [1, 2]);
});

test('固定窓のレート制限: 上限で拒否しRetry-Afterを返し、窓が明けると再開する', () => {
  let now = 1_000;
  const limiter = createFixedWindowRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

  assert.deepEqual(
    [limiter.take(), limiter.take(), limiter.take()].map((d) => d.allowed),
    [true, true, true],
  );
  now += 10_000;
  const rejected = limiter.take();
  assert.equal(rejected.allowed, false);
  if (!rejected.allowed) assert.equal(rejected.retryAfterSeconds, 50);

  now += 50_000;
  assert.equal(limiter.take().allowed, true);
});

test('レート制限の設定値: 既定120/分、不正な値は既定に戻す', () => {
  assert.equal(readRateLimitPerMinute({}), 120);
  assert.equal(readRateLimitPerMinute({ IVRM_INTEGRATION_RATE_LIMIT_PER_MINUTE: '30' }), 30);
  for (const bad of ['0', '-1', 'abc', '1.5', '1000000']) {
    assert.equal(readRateLimitPerMinute({ IVRM_INTEGRATION_RATE_LIMIT_PER_MINUTE: bad }), 120);
  }
});

test('500件の一括リクエストは、メンバー・割り当てとも一括の本文上限(32 KiB)に収まる', () => {
  const ids = Array.from({ length: IVRM_IAM_BATCH_MAX_ITEMS }, (_, index) =>
    String(400_000_000_000_000_000n + BigInt(index)),
  );
  const members = JSON.stringify({ add: ids });
  const attachments = JSON.stringify({ attach: ids.map((id) => ({ type: 'user', id })) });

  assert.ok(
    Buffer.byteLength(members) < IVRM_IAM_BATCH_BODY_MAX_BYTES,
    `members ${Buffer.byteLength(members)}`,
  );
  assert.ok(
    Buffer.byteLength(attachments) < IVRM_IAM_BATCH_BODY_MAX_BYTES,
    `attachments ${Buffer.byteLength(attachments)}`,
  );
  // 割り当ては単体操作の上限(16 KiB)を超える。これが一括の上限を分けている理由。
  assert.ok(Buffer.byteLength(attachments) > 16 * 1024);
});
