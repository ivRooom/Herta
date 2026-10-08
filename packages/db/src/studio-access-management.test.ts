import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  changeStudioAccessGroupMembers,
  changeStudioAccessPolicyAttachments,
  deleteStudioAccessGroupIfCurrent,
  studioAccessPrincipalKey,
  updateStudioAccessGroupIfCurrent,
} from './studio-access-management.js';

/**
 * 実際の PostgreSQL で SQL を検証する統合テスト。`studio_managed_access_policies_v1`
 * マイグレーション適用済みの空のデータベースを `HERTA_IAM_TEST_DATABASE_URL` で指定したときだけ実行する
 * (未設定ならスキップ。このテストは対象テーブルを TRUNCATE するため、本番や共有DBを指さないこと)。
 */
const databaseUrl = process.env['HERTA_IAM_TEST_DATABASE_URL'];
const skip = databaseUrl ? false : 'HERTA_IAM_TEST_DATABASE_URL is not set';

const GUILD = '111111111111111111';
const OTHER_GUILD = '222222222222222222';
const ACTOR = '333333333333333333';

let prisma: PrismaClient;

before(() => {
  if (databaseUrl) prisma = new PrismaClient({ datasourceUrl: databaseUrl });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
});

beforeEach(async () => {
  if (!prisma) return;
  await prisma.$executeRaw`TRUNCATE studio_access_policy_attachments, studio_access_group_members, studio_access_groups, studio_access_policies CASCADE`;
});

async function seedGroup(name: string, guildId = GUILD) {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ updated_at: Date }>>`
    INSERT INTO studio_access_groups (id, guild_id, name, description, created_by, updated_by)
    VALUES (${id}::uuid, ${guildId}, ${name}, NULL, ${ACTOR}, ${ACTOR})
    RETURNING updated_at
  `;
  return { id, updatedAt: rows[0]!.updated_at };
}

async function seedPolicy(name: string, guildId = GUILD) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO studio_access_policies (id, guild_id, name, description, document, created_by, updated_by)
    VALUES (${id}::uuid, ${guildId}, ${name}, NULL, '{}'::jsonb, ${ACTOR}, ${ACTOR})
  `;
  return id;
}

const snowflake = (n: number) => String(400_000_000_000_000_000n + BigInt(n));

async function memberIds(groupId: string) {
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM studio_access_group_members WHERE group_id = ${groupId}::uuid ORDER BY user_id
  `;
  return rows.map((row) => row.user_id);
}

async function attachmentKeys(policyId: string) {
  const rows = await prisma.$queryRaw<Array<{ principal_type: string; principal_id: string }>>`
    SELECT principal_type, principal_id FROM studio_access_policy_attachments
    WHERE policy_id = ${policyId}::uuid ORDER BY principal_type, principal_id
  `;
  return rows.map((row) => `${row.principal_type}:${row.principal_id}`);
}

test('グループ編集は expectedUpdatedAt が一致するときだけ更新する', { skip }, async () => {
  const group = await seedGroup('Moderators');

  const stale = await updateStudioAccessGroupIfCurrent(prisma, {
    guildId: GUILD,
    groupId: group.id,
    name: 'Renamed',
    description: 'x',
    actorId: ACTOR,
    expectedUpdatedAt: new Date(group.updatedAt.getTime() - 1000),
  });
  assert.equal(stale, null);

  const updated = await updateStudioAccessGroupIfCurrent(prisma, {
    guildId: GUILD,
    groupId: group.id,
    name: 'Renamed',
    description: 'desc',
    actorId: ACTOR,
    expectedUpdatedAt: group.updatedAt,
  });
  assert.equal(updated?.name, 'Renamed');
  assert.equal(updated?.description, 'desc');
  assert.ok((updated?.updatedAt.getTime() ?? 0) >= group.updatedAt.getTime());

  // 更新後の古い updatedAt での再送は更新されない(上書きを防ぐ)。
  const replay = await updateStudioAccessGroupIfCurrent(prisma, {
    guildId: GUILD,
    groupId: group.id,
    name: 'Again',
    description: null,
    actorId: ACTOR,
    expectedUpdatedAt: group.updatedAt,
  });
  assert.equal(replay, null);
});

test(
  'グループ編集: 他ギルドのグループは更新できず、同名は unique 違反になる',
  { skip },
  async () => {
    const mine = await seedGroup('Alpha');
    await seedGroup('Beta');
    const foreign = await seedGroup('Gamma', OTHER_GUILD);

    assert.equal(
      await updateStudioAccessGroupIfCurrent(prisma, {
        guildId: GUILD,
        groupId: foreign.id,
        name: 'Hijack',
        description: null,
        actorId: ACTOR,
        expectedUpdatedAt: foreign.updatedAt,
      }),
      null,
    );

    await assert.rejects(
      updateStudioAccessGroupIfCurrent(prisma, {
        guildId: GUILD,
        groupId: mine.id,
        name: 'beta',
        description: null,
        actorId: ACTOR,
        expectedUpdatedAt: mine.updatedAt,
      }),
    );
  },
);

test('グループ削除: 存在しない/古い updatedAt は削除しない', { skip }, async () => {
  const group = await seedGroup('Alpha');

  assert.deepEqual(
    await deleteStudioAccessGroupIfCurrent(prisma, {
      guildId: GUILD,
      groupId: randomUUID(),
      expectedUpdatedAt: group.updatedAt,
      cascade: false,
      membersLimit: 50,
    }),
    { status: 'not_found' },
  );
  assert.deepEqual(
    await deleteStudioAccessGroupIfCurrent(prisma, {
      guildId: GUILD,
      groupId: group.id,
      expectedUpdatedAt: new Date(group.updatedAt.getTime() + 5000),
      cascade: true,
      membersLimit: 50,
    }),
    { status: 'stale' },
  );
  const remaining = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM studio_access_groups WHERE id = ${group.id}::uuid
  `;
  assert.equal(remaining.length, 1);
});

test(
  'グループ削除: 残りがあれば cascade=false は削除せず、残っているものを返す',
  { skip },
  async () => {
    const group = await seedGroup('Alpha');
    const policy = await seedPolicy('Moderation');
    const otherPolicy = await seedPolicy('Zeta');
    const members = Array.from({ length: 60 }, (_, index) => snowflake(index));
    await changeStudioAccessGroupMembers(prisma, {
      guildId: GUILD,
      groupId: group.id,
      add: members,
      remove: [],
      actorId: ACTOR,
    });
    await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: policy,
      attach: [{ type: 'group', id: group.id }],
      detach: [],
      actorId: ACTOR,
    });
    await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: otherPolicy,
      attach: [
        { type: 'group', id: group.id },
        { type: 'user', id: snowflake(1) },
      ],
      detach: [],
      actorId: ACTOR,
    });

    const result = await deleteStudioAccessGroupIfCurrent(prisma, {
      guildId: GUILD,
      groupId: group.id,
      expectedUpdatedAt: group.updatedAt,
      cascade: false,
      membersLimit: 25,
    });

    assert.equal(result.status, 'has_dependencies');
    if (result.status !== 'has_dependencies') return;
    assert.equal(result.dependencies.memberCount, 60);
    assert.equal(result.dependencies.members.length, 25);
    assert.deepEqual(
      result.dependencies.policyAttachments.map((attachment) => attachment.policyName),
      ['Moderation', 'Zeta'],
    );
    // 何も削除されていない。
    assert.equal((await memberIds(group.id)).length, 60);
    assert.deepEqual(await attachmentKeys(policy), [`group:${group.id}`]);
  },
);

test(
  'グループ削除: cascade=true は割り当てとメンバーも削除し、他の割り当ては残す',
  { skip },
  async () => {
    const group = await seedGroup('Alpha');
    const policy = await seedPolicy('Moderation');
    await changeStudioAccessGroupMembers(prisma, {
      guildId: GUILD,
      groupId: group.id,
      add: [snowflake(1), snowflake(2)],
      remove: [],
      actorId: ACTOR,
    });
    await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: policy,
      attach: [
        { type: 'group', id: group.id },
        { type: 'user', id: snowflake(9) },
      ],
      detach: [],
      actorId: ACTOR,
    });

    const result = await deleteStudioAccessGroupIfCurrent(prisma, {
      guildId: GUILD,
      groupId: group.id,
      expectedUpdatedAt: group.updatedAt,
      cascade: true,
      membersLimit: 50,
    });

    assert.deepEqual(result, {
      status: 'deleted',
      removed: { memberCount: 2, policyAttachmentCount: 1 },
    });
    assert.deepEqual(await attachmentKeys(policy), [`user:${snowflake(9)}`]);
    assert.deepEqual(await memberIds(group.id), []);
  },
);

test('グループ削除: 何も残っていなければ cascade=false でも削除できる', { skip }, async () => {
  const group = await seedGroup('Empty');
  const result = await deleteStudioAccessGroupIfCurrent(prisma, {
    guildId: GUILD,
    groupId: group.id,
    expectedUpdatedAt: group.updatedAt,
    cascade: false,
    membersLimit: 50,
  });
  assert.deepEqual(result, {
    status: 'deleted',
    removed: { memberCount: 0, policyAttachmentCount: 0 },
  });
});

test(
  'メンバー一括: 追加・削除は冪等で、変わった要素だけを返す。500件を1回で適用できる',
  { skip },
  async () => {
    const group = await seedGroup('Alpha');
    const first = Array.from({ length: 500 }, (_, index) => snowflake(index));

    const added = await changeStudioAccessGroupMembers(prisma, {
      guildId: GUILD,
      groupId: group.id,
      add: first,
      remove: [],
      actorId: ACTOR,
    });
    assert.equal(added.status, 'ok');
    if (added.status !== 'ok') return;
    assert.equal(added.added.size, 500);
    assert.equal((await memberIds(group.id)).length, 500);

    // 再送すると全件 changed=false(自然冪等)。
    const replay = await changeStudioAccessGroupMembers(prisma, {
      guildId: GUILD,
      groupId: group.id,
      add: first,
      remove: [],
      actorId: ACTOR,
    });
    assert.equal(replay.status === 'ok' && replay.added.size, 0);

    // 追加と削除を同時に。存在しないメンバーの削除は changed=false。
    const mixed = await changeStudioAccessGroupMembers(prisma, {
      guildId: GUILD,
      groupId: group.id,
      add: [snowflake(900)],
      remove: [snowflake(0), snowflake(1), snowflake(99999)],
      actorId: ACTOR,
    });
    assert.equal(mixed.status, 'ok');
    if (mixed.status !== 'ok') return;
    assert.deepEqual([...mixed.added], [snowflake(900)]);
    assert.deepEqual([...mixed.removed].sort(), [snowflake(0), snowflake(1)]);
    assert.equal((await memberIds(group.id)).length, 499);
  },
);

test('メンバー一括: 存在しないグループ・他ギルドのグループは not_found', { skip }, async () => {
  const foreign = await seedGroup('Foreign', OTHER_GUILD);
  for (const groupId of [randomUUID(), foreign.id]) {
    assert.deepEqual(
      await changeStudioAccessGroupMembers(prisma, {
        guildId: GUILD,
        groupId,
        add: [snowflake(1)],
        remove: [],
        actorId: ACTOR,
      }),
      { status: 'not_found' },
    );
  }
  assert.deepEqual(await memberIds(foreign.id), []);
});

test(
  '割り当て一括: 割り当て・解除は冪等で、stale な principal も解除できる',
  { skip },
  async () => {
    const policy = await seedPolicy('Moderation');
    const group = await seedGroup('Alpha');
    const principals = [
      { type: 'user' as const, id: snowflake(1) },
      { type: 'role' as const, id: snowflake(2) },
      { type: 'group' as const, id: group.id },
    ];

    const attached = await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: policy,
      attach: principals,
      detach: [],
      actorId: ACTOR,
    });
    assert.equal(attached.status, 'ok');
    if (attached.status !== 'ok') return;
    assert.deepEqual(
      [...attached.attached].sort(),
      principals.map(studioAccessPrincipalKey).sort(),
    );

    const replay = await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: policy,
      attach: principals,
      detach: [],
      actorId: ACTOR,
    });
    assert.equal(replay.status === 'ok' && replay.attached.size, 0);

    // 退出済みユーザーのような stale な principal(存在しない id)も解除できる。
    const detached = await changeStudioAccessPolicyAttachments(prisma, {
      guildId: GUILD,
      policyId: policy,
      attach: [],
      detach: [principals[0]!, { type: 'user', id: snowflake(777) }],
      actorId: ACTOR,
    });
    assert.equal(detached.status, 'ok');
    if (detached.status !== 'ok') return;
    assert.deepEqual([...detached.detached], [studioAccessPrincipalKey(principals[0]!)]);
    assert.equal((await attachmentKeys(policy)).length, 2);
  },
);

test('割り当て一括: 存在しないポリシー・他ギルドのポリシーは not_found', { skip }, async () => {
  const foreign = await seedPolicy('Foreign', OTHER_GUILD);
  for (const policyId of [randomUUID(), foreign]) {
    assert.deepEqual(
      await changeStudioAccessPolicyAttachments(prisma, {
        guildId: GUILD,
        policyId,
        attach: [{ type: 'user', id: snowflake(1) }],
        detach: [],
        actorId: ACTOR,
      }),
      { status: 'not_found' },
    );
  }
  assert.deepEqual(await attachmentKeys(foreign), []);
});
