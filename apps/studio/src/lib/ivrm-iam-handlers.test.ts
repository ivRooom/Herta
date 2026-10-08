import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIvrmIamHandlers,
  type IamGroup,
  type IvrmIamAuditEntry,
  type IvrmIamDeps,
} from './ivrm-iam-handlers.ts';
import { principalKey } from './ivrm-iam-management.ts';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from './studio-access-policy.ts';

const GUILD = '111111111111111111';
const ACTOR = '222222222222222222';
const USER = '333333333333333333';
const USER_2 = '444444444444444444';
const ROLE = '555555555555555555';
const GROUP = '3f6c1a52-8e63-4a53-9d2f-0c1b6f8a7e10';
const OTHER_GROUP = '9a1d5c2e-6b7f-4c8d-8e9a-1b2c3d4e5f60';
const POLICY = 'c1f0a9e8-7d6b-4a5c-9b8e-0f1a2b3c4d5e';
const UPDATED_AT = new Date('2026-10-08T12:00:00.000Z');

type Overrides = Partial<IvrmIamDeps> & {
  groups?: IamGroup[];
  members?: Set<string>;
  roleIds?: Set<string> | null;
  policyExists?: boolean;
};

function setup(overrides: Overrides = {}) {
  const audits: IvrmIamAuditEntry[] = [];
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, input: unknown) => {
    (calls[name] ??= []).push(input);
  };
  const groups = overrides.groups ?? [
    { id: GROUP, name: 'Moderators', description: null, updatedAt: UPDATED_AT },
    { id: OTHER_GROUP, name: 'Developers', description: null, updatedAt: UPDATED_AT },
  ];
  const guildMembers = overrides.members ?? new Set([USER, USER_2]);

  const deps: IvrmIamDeps = {
    authorize: () => ({ status: 'authorized', config: { token: 't'.repeat(32), guildId: GUILD } }),
    rateLimiter: { take: () => ({ allowed: true }) },
    listGroups: async () => groups,
    findPolicy: async () =>
      overrides.policyExists === false ? null : { id: POLICY, name: 'Moderation' },
    updateGroupIfCurrent: async (input) => {
      record('updateGroupIfCurrent', input);
      return {
        id: input.groupId,
        name: input.name,
        description: input.description,
        updatedAt: new Date('2026-10-08T12:30:00.000Z'),
      };
    },
    deleteGroupIfCurrent: async (input) => {
      record('deleteGroupIfCurrent', input);
      return { status: 'deleted', removed: { memberCount: 0, policyAttachmentCount: 0 } };
    },
    changeMembers: async (input) => {
      record('changeMembers', input);
      return { status: 'ok', added: new Set(input.add), removed: new Set(input.remove) };
    },
    changeAttachments: async (input) => {
      record('changeAttachments', input);
      return {
        status: 'ok',
        attached: new Set(input.attach.map(principalKey)),
        detached: new Set(input.detach.map(principalKey)),
      };
    },
    getRoleIds: async () => (overrides.roleIds === undefined ? new Set([ROLE]) : overrides.roleIds),
    hasGuildMember: async (_guildId, userId) => guildMembers.has(userId),
    audit: async (entry) => {
      audits.push(entry);
    },
    isUniqueViolation: () => false,
    ...overrides,
  };
  return { handlers: createIvrmIamHandlers(deps), audits, calls };
}

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://herta.test${url}`, {
    method,
    headers: {
      'x-ivrm-actor-id': ACTOR,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const groupParams = { guildId: GUILD, groupId: GROUP };

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------- 認証・共通

test('未設定は503、不正なtokenは401(WWW-Authenticate)、別ギルドは404、actor不正は400', async () => {
  const unconfigured = setup({ authorize: () => ({ status: 'unconfigured' }) });
  assert.equal(
    (await unconfigured.handlers.updateGroup(req('PATCH', '/x', {}), groupParams)).status,
    503,
  );

  const unauthorized = setup({ authorize: () => ({ status: 'unauthorized' }) });
  const denied = await unauthorized.handlers.deleteGroup(req('DELETE', '/x'), groupParams);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate') ?? '', /Bearer/);

  const { handlers } = setup();
  assert.equal(
    (
      await handlers.updateGroup(req('PATCH', '/x', {}), {
        ...groupParams,
        guildId: '999999999999999999',
      })
    ).status,
    404,
  );
  assert.equal(
    (await handlers.updateGroup(req('PATCH', '/x', {}, { 'x-ivrm-actor-id': 'abc' }), groupParams))
      .status,
    400,
  );
});

test('レート制限を超えると429とRetry-Afterを返し、何も実行しない', async () => {
  const { handlers, calls } = setup({
    rateLimiter: { take: () => ({ allowed: false, retryAfterSeconds: 42 }) },
  });
  const response = await handlers.changeMembersBatch(
    req('POST', '/x', { add: [USER] }),
    groupParams,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '42');
  assert.equal(calls['changeMembers'], undefined);
});

test('本文はapplication/json・16 KiB以内・有効なJSONだけ受け付ける', async () => {
  const { handlers } = setup();
  const noType = new Request('https://herta.test/x', {
    method: 'POST',
    headers: { 'x-ivrm-actor-id': ACTOR },
    body: '{}',
  });
  assert.equal((await handlers.changeMembersBatch(noType, groupParams)).status, 400);
  const badJson = new Request('https://herta.test/x', {
    method: 'POST',
    headers: { 'x-ivrm-actor-id': ACTOR, 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal((await handlers.changeMembersBatch(badJson, groupParams)).status, 400);
  // 単体操作は 16 KiB、一括は 32 KiB が上限(500 件の principal が約 23 KB のため)。
  const single = req('PATCH', '/x', {
    name: 'a',
    expectedUpdatedAt: '2026-10-08T12:00:00Z',
    pad: 'x'.repeat(17 * 1024),
  });
  assert.equal((await handlers.updateGroup(single, groupParams)).status, 413);
  const batchOk = req('POST', '/x', { add: [USER], pad: 'x'.repeat(17 * 1024) });
  assert.equal((await handlers.changeMembersBatch(batchOk, groupParams)).status, 200);
  const batchBig = req('POST', '/x', { add: [USER], pad: 'x'.repeat(33 * 1024) });
  assert.equal((await handlers.changeMembersBatch(batchBig, groupParams)).status, 413);
});

// ---------------------------------------------------------------- グループ編集

test('グループ編集: 成功すると更新後のグループを返し、監査に1件記録する', async () => {
  const { handlers, audits, calls } = setup();
  const response = await handlers.updateGroup(
    req('PATCH', '/x', {
      name: ' Renamed ',
      description: 'd',
      expectedUpdatedAt: '2026-10-08T12:00:00.000Z',
    }),
    groupParams,
  );
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body['status'], 'ok');
  assert.deepEqual(body['group'], {
    id: GROUP,
    name: 'Renamed',
    description: 'd',
    updatedAt: '2026-10-08T12:30:00.000Z',
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.event, 'studio_access_group.updated');
  assert.deepEqual(audits[0]?.changes, { name: 'Renamed' });
  assert.equal((calls['updateGroupIfCurrent']?.[0] as { actorId: string }).actorId, ACTOR);
});

test('グループ編集: 存在しない=404、同名=409、古いexpectedUpdatedAt=409 stale_group(監査なし)', async () => {
  const ok = { name: 'Renamed', expectedUpdatedAt: '2026-10-08T12:00:00.000Z' };
  const first = setup();
  assert.equal(
    (
      await first.handlers.updateGroup(req('PATCH', '/x', ok), {
        ...groupParams,
        groupId: '11111111-1111-4111-8111-111111111111',
      })
    ).status,
    404,
  );

  const duplicate = await first.handlers.updateGroup(
    req('PATCH', '/x', { ...ok, name: 'developers' }),
    groupParams,
  );
  assert.equal(duplicate.status, 409);

  const stale = setup({ updateGroupIfCurrent: async () => null });
  const response = await stale.handlers.updateGroup(req('PATCH', '/x', ok), groupParams);
  assert.equal(response.status, 409);
  assert.equal((await json(response))['error'], 'stale_group');
  assert.equal(stale.audits.length, 0);

  assert.equal(
    (await first.handlers.updateGroup(req('PATCH', '/x', { name: 'x' }), groupParams)).status,
    400,
  );
});

test('グループ編集: 同時実行で同名が作られた場合のunique違反は409', async () => {
  const { handlers } = setup({
    updateGroupIfCurrent: async () => {
      throw new Error('P2010');
    },
    isUniqueViolation: () => true,
  });
  const response = await handlers.updateGroup(
    req('PATCH', '/x', { name: 'Renamed', expectedUpdatedAt: '2026-10-08T12:00:00.000Z' }),
    groupParams,
  );
  assert.equal(response.status, 409);
});

// ---------------------------------------------------------------- グループ削除

const DELETE_URL = '/x?expectedUpdatedAt=2026-10-08T12:00:00.000Z';

test('グループ削除: 残りがあると409 group_has_dependenciesで、残っているものを返し、監査しない', async () => {
  const dependencies = {
    memberCount: 3,
    members: [USER, USER_2],
    policyAttachments: [{ policyId: POLICY, policyName: 'Moderation' }],
  };
  const deleteCalls: unknown[] = [];
  const { handlers, audits } = setup({
    deleteGroupIfCurrent: async (input) => {
      deleteCalls.push(input);
      return { status: 'has_dependencies', dependencies };
    },
  });
  const response = await handlers.deleteGroup(
    req('DELETE', `${DELETE_URL}&membersLimit=25`),
    groupParams,
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await json(response), { error: 'group_has_dependencies', dependencies });
  assert.equal(audits.length, 0);
  assert.equal((deleteCalls[0] as { cascade: boolean }).cascade, false);
  assert.equal((deleteCalls[0] as { membersLimit: number }).membersLimit, 25);
});

test('グループ削除: cascade=trueで削除し、削除した件数を返し、監査に残す', async () => {
  const { handlers, audits } = setup({
    deleteGroupIfCurrent: async () => ({
      status: 'deleted',
      removed: { memberCount: 3, policyAttachmentCount: 1 },
    }),
  });
  const response = await handlers.deleteGroup(
    req('DELETE', `${DELETE_URL}&cascade=true`),
    groupParams,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    status: 'ok',
    deleted: true,
    groupId: GROUP,
    removed: { memberCount: 3, policyAttachmentCount: 1 },
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.event, 'studio_access_group.deleted');
  assert.deepEqual(audits[0]?.changes, {
    name: 'Moderators',
    removed: { memberCount: 3, policyAttachmentCount: 1 },
  });
});

test('グループ削除: 古いexpectedUpdatedAtは409 stale_group、不正なクエリは400、存在しなければ404', async () => {
  const stale = setup({ deleteGroupIfCurrent: async () => ({ status: 'stale' }) });
  const staleResponse = await stale.handlers.deleteGroup(req('DELETE', DELETE_URL), groupParams);
  assert.equal(staleResponse.status, 409);
  assert.equal((await json(staleResponse))['error'], 'stale_group');

  const { handlers } = setup();
  assert.equal((await handlers.deleteGroup(req('DELETE', '/x'), groupParams)).status, 400);
  assert.equal(
    (await handlers.deleteGroup(req('DELETE', `${DELETE_URL}&membersLimit=7`), groupParams)).status,
    400,
  );
  assert.equal(
    (
      await handlers.deleteGroup(req('DELETE', DELETE_URL), {
        ...groupParams,
        groupId: '11111111-1111-4111-8111-111111111111',
      })
    ).status,
    404,
  );
});

// ---------------------------------------------------------------- メンバー(単体)

test('メンバー追加: ギルドメンバーでなければ404、変更があれば監査、変更がなければchanged=falseで監査なし', async () => {
  const params = { ...groupParams, userId: USER };
  const { handlers, audits } = setup();

  const added = await handlers.changeMember(req('PUT', '/x'), params, 'add');
  assert.deepEqual(await json(added), { status: 'ok', changed: true });
  assert.equal(audits[0]?.event, 'studio_access_group.member_added');

  const notMember = await handlers.changeMember(
    req('PUT', '/x'),
    { ...groupParams, userId: '999999999999999999' },
    'add',
  );
  assert.equal(notMember.status, 404);

  const noop = setup({
    changeMembers: async () => ({ status: 'ok', added: new Set(), removed: new Set() }),
  });
  const replay = await noop.handlers.changeMember(req('PUT', '/x'), params, 'add');
  assert.deepEqual(await json(replay), { status: 'ok', changed: false });
  assert.equal(noop.audits.length, 0);
});

test('メンバー削除: ギルドを退出済みのユーザーも確認なしで削除できる', async () => {
  const { handlers, audits } = setup({ members: new Set() });
  const response = await handlers.changeMember(
    req('DELETE', '/x'),
    { ...groupParams, userId: USER },
    'remove',
  );
  assert.deepEqual(await json(response), { status: 'ok', changed: true });
  assert.equal(audits[0]?.event, 'studio_access_group.member_removed');
});

// ---------------------------------------------------------------- メンバー(一括)

test('メンバー一括: 全件検証してから1回で適用し、要素ごとの結果と、変更のある種別だけの監査を返す', async () => {
  let applyCount = 0;
  const { handlers, audits } = setup({
    changeMembers: async (input) => {
      applyCount += 1;
      return { status: 'ok', added: new Set([USER]), removed: new Set(input.remove) };
    },
  });
  const response = await handlers.changeMembersBatch(
    req('POST', '/x', { add: [USER, USER_2], remove: [ROLE] }),
    groupParams,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    status: 'ok',
    results: [
      { userId: USER, action: 'add', changed: true },
      { userId: USER_2, action: 'add', changed: false },
      { userId: ROLE, action: 'remove', changed: true },
    ],
  });
  assert.deepEqual(
    audits.map((entry) => entry.event),
    ['studio_access_group.member_added', 'studio_access_group.member_removed'],
  );
  assert.equal((audits[0]?.changes as { count: number }).count, 1);
  assert.equal(applyCount, 1);
});

test('メンバー一括: 1件でも不正なら何も適用せず、元の位置つきの要素ごとのエラーを返す', async () => {
  const { handlers, calls, audits } = setup();
  const response = await handlers.changeMembersBatch(
    req('POST', '/x', { add: [USER, USER, '999999999999999999', 'oops'] }),
    groupParams,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), {
    error: 'Batch validation failed',
    itemErrors: [{ list: 'add', index: 3, code: 'invalid_id' }],
  });
  assert.equal(calls['changeMembers'], undefined);

  // 形式は正しいがギルドにいないメンバー。重複を除く前の位置(index 2)で報告する。
  const missing = await handlers.changeMembersBatch(
    req('POST', '/x', { add: [USER, USER, '999999999999999999'] }),
    groupParams,
  );
  assert.equal(missing.status, 400);
  assert.deepEqual((await json(missing))['itemErrors'], [
    { list: 'add', index: 2, code: 'not_a_guild_member' },
  ]);
  assert.equal(calls['changeMembers'], undefined);
  assert.equal(audits.length, 0);
});

test('メンバー一括: 削除は退出済みのユーザーでも検証せず、グループが無ければ404', async () => {
  const { handlers } = setup({ members: new Set() });
  const response = await handlers.changeMembersBatch(
    req('POST', '/x', { remove: [USER] }),
    groupParams,
  );
  assert.equal(response.status, 200);

  const missingGroup = await handlers.changeMembersBatch(req('POST', '/x', { add: [USER] }), {
    ...groupParams,
    groupId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(missingGroup.status, 404);
});

test('メンバー一括: 監査のuserIdsは100件まで、countは全件', async () => {
  const ids = Array.from({ length: 250 }, (_, index) =>
    String(500_000_000_000_000_000n + BigInt(index)),
  );
  const { handlers, audits } = setup({ members: new Set(ids) });
  const response = await handlers.changeMembersBatch(req('POST', '/x', { add: ids }), groupParams);
  assert.equal(response.status, 200);
  const changes = audits[0]?.changes as { count: number; userIds: string[] };
  assert.equal(changes.count, 250);
  assert.equal(changes.userIds.length, 100);
});

// ---------------------------------------------------------------- ポリシー割り当て(単体)

const attachParams = (principalType: string, principalId: string) => ({
  guildId: GUILD,
  policyId: POLICY,
  principalType,
  principalId,
});

test('割り当て: user/role/groupが存在すれば成功し、監査にpolicy名とprincipalを残す', async () => {
  const { handlers, audits } = setup();
  for (const [type, id] of [
    ['user', USER],
    ['role', ROLE],
    ['group', GROUP],
  ] as const) {
    const response = await handlers.changeAttachment(
      req('PUT', '/x'),
      attachParams(type, id),
      'attach',
    );
    assert.deepEqual(await json(response), { status: 'ok', changed: true });
  }
  assert.equal(audits.length, 3);
  assert.equal(audits[0]?.event, 'studio_access_policy.attached');
  assert.deepEqual(audits[1]?.changes, {
    policyName: 'Moderation',
    principalType: 'role',
    principalId: ROLE,
  });
});

test('割り当て: OWNER rootロールは400、存在しないrole/group/userは404、ロール一覧が取得できなければ503', async () => {
  const { handlers, calls } = setup();
  assert.equal(
    (
      await handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('role', STUDIO_ROOT_DISCORD_ROLE_ID),
        'attach',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('role', '888888888888888888'),
        'attach',
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('group', '11111111-1111-4111-8111-111111111111'),
        'attach',
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('user', '999999999999999999'),
        'attach',
      )
    ).status,
    404,
  );
  assert.equal(calls['changeAttachments'], undefined);

  const unavailable = setup({ roleIds: null });
  assert.equal(
    (
      await unavailable.handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('role', ROLE),
        'attach',
      )
    ).status,
    503,
  );
});

test('解除: principalの存在確認をしないので、stale・root・存在しないIDでも解除できる', async () => {
  const { handlers, audits } = setup({ members: new Set(), roleIds: null });
  for (const [type, id] of [
    ['user', '999999999999999999'],
    ['role', STUDIO_ROOT_DISCORD_ROLE_ID],
    ['group', '11111111-1111-4111-8111-111111111111'],
  ] as const) {
    const response = await handlers.changeAttachment(
      req('DELETE', '/x'),
      attachParams(type, id),
      'detach',
    );
    assert.equal(response.status, 200);
  }
  assert.equal(audits.length, 3);
  assert.equal(audits[0]?.event, 'studio_access_policy.detached');
});

test('割り当て: ポリシーが無ければ404、principal形式が不正なら400', async () => {
  const noPolicy = setup({ policyExists: false });
  assert.equal(
    (
      await noPolicy.handlers.changeAttachment(
        req('PUT', '/x'),
        attachParams('user', USER),
        'attach',
      )
    ).status,
    404,
  );
  const { handlers } = setup();
  assert.equal(
    (await handlers.changeAttachment(req('PUT', '/x'), attachParams('plugin', USER), 'attach'))
      .status,
    400,
  );
  assert.equal(
    (await handlers.changeAttachment(req('PUT', '/x'), attachParams('user', 'abc'), 'attach'))
      .status,
    400,
  );
});

// ---------------------------------------------------------------- ポリシー割り当て(一括)

test('割り当て一括: 全件を検証し、rootロール等は元の位置つきのエラーで何も適用しない', async () => {
  const { handlers, calls } = setup();
  const response = await handlers.changeAttachmentsBatch(
    req('POST', '/x', {
      attach: [
        { type: 'user', id: USER },
        { type: 'role', id: STUDIO_ROOT_DISCORD_ROLE_ID },
        { type: 'role', id: '888888888888888888' },
        { type: 'user', id: '999999999999999999' },
      ],
    }),
    { guildId: GUILD, policyId: POLICY },
  );
  assert.equal(response.status, 400);
  assert.deepEqual((await json(response))['itemErrors'], [
    { list: 'attach', index: 1, code: 'root_role_not_allowed' },
    { list: 'attach', index: 2, code: 'role_not_found' },
    { list: 'attach', index: 3, code: 'not_a_guild_member' },
  ]);
  assert.equal(calls['changeAttachments'], undefined);
});

test('割り当て一括: 成功すると要素ごとの結果を返す。解除は存在確認なしで、監査は変更のあった種別だけ', async () => {
  const stale = { type: 'user' as const, id: '999999999999999999' };
  const { handlers, audits } = setup({
    changeAttachments: async (input) => ({
      status: 'ok',
      attached: new Set(input.attach.map(principalKey)),
      detached: new Set(),
    }),
  });
  const response = await handlers.changeAttachmentsBatch(
    req('POST', '/x', { attach: [{ type: 'user', id: USER }], detach: [stale] }),
    { guildId: GUILD, policyId: POLICY },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    status: 'ok',
    results: [
      { principalType: 'user', principalId: USER, action: 'attach', changed: true },
      { principalType: 'user', principalId: stale.id, action: 'detach', changed: false },
    ],
  });
  assert.deepEqual(
    audits.map((entry) => entry.event),
    ['studio_access_policy.attached'],
  );
});

test('割り当て一括: ロール一覧が取得できなければ503(適用しない)、ポリシーが無ければ404', async () => {
  const unavailable = setup({ roleIds: null });
  const response = await unavailable.handlers.changeAttachmentsBatch(
    req('POST', '/x', { attach: [{ type: 'role', id: ROLE }] }),
    { guildId: GUILD, policyId: POLICY },
  );
  assert.equal(response.status, 503);
  assert.equal(unavailable.calls['changeAttachments'], undefined);

  const noPolicy = setup({ policyExists: false });
  assert.equal(
    (
      await noPolicy.handlers.changeAttachmentsBatch(
        req('POST', '/x', { detach: [{ type: 'user', id: USER }] }),
        {
          guildId: GUILD,
          policyId: POLICY,
        },
      )
    ).status,
    404,
  );
});

test('監査の書き込みが失敗しても操作自体は成功として返す(監査失敗はログに残す)', async () => {
  const { handlers } = setup({
    audit: async () => {
      throw new Error('audit down');
    },
  });
  const original = console.error;
  console.error = () => undefined;
  try {
    const response = await handlers.changeMember(
      req('PUT', '/x'),
      { ...groupParams, userId: USER },
      'add',
    );
    assert.deepEqual(await json(response), { status: 'ok', changed: true });
  } finally {
    console.error = original;
  }
});
