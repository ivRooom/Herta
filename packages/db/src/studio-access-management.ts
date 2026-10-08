import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  StudioAccessGroupRecord,
  StudioAccessPrincipalType,
} from './studio-access-control.js';

/**
 * ivRooom IAM 連携(herta-iam v1.1.0)用の管理操作。
 *
 * 既存の Studio 向け関数(update / delete / attach / detach / member)と同じテーブルと不変条件を使い、
 * 連携に必要な次の3点だけを足す。
 *  - 楽観的同時実行制御(`expectedUpdatedAt`)つきの編集・削除
 *  - 削除時に「何が残っているか」を返すこと(`cascade=false`)
 *  - 1トランザクションで適用する一括操作(全か無か)
 */

export const STUDIO_ACCESS_MEMBERS_LIMIT_OPTIONS = [25, 50, 100, 500, 1000] as const;
export const STUDIO_ACCESS_MEMBERS_LIMIT_DEFAULT = 50;

interface GroupRow {
  id: string;
  guild_id: string;
  name: string;
  description: string | null;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

function mapGroupRow(row: GroupRow): StudioAccessGroupRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 呼び出し側が最後に読んだ `updatedAt` と一致するときだけ更新する。一致しなければ null。
 * 存在しないグループと古い `updatedAt` の区別は、呼び出し側が事前に一覧で確認する。
 * 同名のグループがあれば unique 違反を投げる(呼び出し側が 409 にする)。
 */
export async function updateStudioAccessGroupIfCurrent(
  prisma: PrismaClient,
  input: {
    guildId: string;
    groupId: string;
    name: string;
    description: string | null;
    actorId: string;
    expectedUpdatedAt: Date;
  },
): Promise<StudioAccessGroupRecord | null> {
  const rows = await prisma.$queryRaw<GroupRow[]>`
    UPDATE studio_access_groups
    SET name = ${input.name},
        description = ${input.description},
        updated_by = ${input.actorId},
        updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ${input.guildId}
      AND id = ${input.groupId.toLowerCase()}::uuid
      AND updated_at = ${input.expectedUpdatedAt}::timestamptz
    RETURNING id, guild_id, name, description, created_by, updated_by, created_at, updated_at
  `;
  const row = rows[0];
  return row ? mapGroupRow(row) : null;
}

export interface StudioAccessGroupDependencies {
  memberCount: number;
  /** 最大 `membersLimit` 件。残りは `memberCount` で件数だけ分かる。 */
  members: string[];
  policyAttachments: Array<{ policyId: string; policyName: string }>;
}

export type DeleteStudioAccessGroupResult =
  | { status: 'not_found' }
  | { status: 'stale' }
  | { status: 'has_dependencies'; dependencies: StudioAccessGroupDependencies }
  | { status: 'deleted'; removed: { memberCount: number; policyAttachmentCount: number } };

/**
 * `cascade=false` では、メンバーまたはポリシー割り当てが残っていれば何も削除せずに残りを返す。
 * `cascade=true` では、割り当てとメンバーを同じトランザクションで削除してからグループを削除する。
 */
export async function deleteStudioAccessGroupIfCurrent(
  prisma: PrismaClient,
  input: {
    guildId: string;
    groupId: string;
    expectedUpdatedAt: Date;
    cascade: boolean;
    membersLimit: number;
  },
): Promise<DeleteStudioAccessGroupResult> {
  const groupId = input.groupId.toLowerCase();

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ updated_at: Date }>>`
      SELECT updated_at FROM studio_access_groups
      WHERE guild_id = ${input.guildId} AND id = ${groupId}::uuid
      FOR UPDATE
    `;
    const current = locked[0];
    if (!current) return { status: 'not_found' } as const;
    if (current.updated_at.getTime() !== input.expectedUpdatedAt.getTime()) {
      return { status: 'stale' } as const;
    }

    const [countRows, memberRows, attachmentRows] = await Promise.all([
      tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM studio_access_group_members
        WHERE guild_id = ${input.guildId} AND group_id = ${groupId}::uuid
      `,
      tx.$queryRaw<Array<{ user_id: string }>>`
        SELECT user_id FROM studio_access_group_members
        WHERE guild_id = ${input.guildId} AND group_id = ${groupId}::uuid
        ORDER BY created_at, user_id
        LIMIT ${input.membersLimit}
      `,
      tx.$queryRaw<Array<{ policy_id: string; policy_name: string }>>`
        SELECT a.policy_id, p.name AS policy_name
        FROM studio_access_policy_attachments a
        INNER JOIN studio_access_policies p
          ON p.id = a.policy_id AND p.guild_id = a.guild_id
        WHERE a.guild_id = ${input.guildId}
          AND a.principal_type = 'group'
          AND a.principal_id = ${groupId}
        ORDER BY lower(p.name), a.policy_id
      `,
    ]);

    const memberCount = countRows[0]?.count ?? 0;
    const policyAttachments = attachmentRows.map((row) => ({
      policyId: row.policy_id,
      policyName: row.policy_name,
    }));

    if (!input.cascade && (memberCount > 0 || policyAttachments.length > 0)) {
      return {
        status: 'has_dependencies',
        dependencies: {
          memberCount,
          members: memberRows.map((row) => row.user_id),
          policyAttachments,
        },
      } as const;
    }

    // principal_id は groups への外部キーを持たないため、割り当てはここで明示的に消す。
    // メンバーは studio_access_group_members の外部キー(ON DELETE CASCADE)で消える。
    const removedAttachments = await tx.$executeRaw`
      DELETE FROM studio_access_policy_attachments
      WHERE guild_id = ${input.guildId}
        AND principal_type = 'group'
        AND principal_id = ${groupId}
    `;
    await tx.$executeRaw`
      DELETE FROM studio_access_groups
      WHERE guild_id = ${input.guildId} AND id = ${groupId}::uuid
    `;

    return {
      status: 'deleted',
      removed: { memberCount, policyAttachmentCount: removedAttachments },
    } as const;
  });
}

export type ChangeStudioAccessGroupMembersResult =
  { status: 'not_found' } | { status: 'ok'; added: Set<string>; removed: Set<string> };

/** 追加・削除を 1 トランザクションで適用し、実際に変わった user id を返す。 */
export async function changeStudioAccessGroupMembers(
  prisma: PrismaClient,
  input: {
    guildId: string;
    groupId: string;
    add: readonly string[];
    remove: readonly string[];
    actorId: string;
  },
): Promise<ChangeStudioAccessGroupMembersResult> {
  const groupId = input.groupId.toLowerCase();

  return prisma.$transaction(async (tx) => {
    const group = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM studio_access_groups
      WHERE guild_id = ${input.guildId} AND id = ${groupId}::uuid
      FOR SHARE
    `;
    if (group.length === 0) return { status: 'not_found' } as const;

    const added =
      input.add.length === 0
        ? []
        : await tx.$queryRaw<Array<{ user_id: string }>>`
            INSERT INTO studio_access_group_members (group_id, guild_id, user_id, created_by)
            SELECT ${groupId}::uuid, ${input.guildId}, u.user_id, ${input.actorId}
            FROM unnest(${[...input.add]}::text[]) AS u(user_id)
            ON CONFLICT (group_id, user_id) DO NOTHING
            RETURNING user_id
          `;
    const removed =
      input.remove.length === 0
        ? []
        : await tx.$queryRaw<Array<{ user_id: string }>>`
            DELETE FROM studio_access_group_members
            WHERE guild_id = ${input.guildId}
              AND group_id = ${groupId}::uuid
              AND user_id = ANY(${[...input.remove]}::text[])
            RETURNING user_id
          `;

    return {
      status: 'ok',
      added: new Set(added.map((row) => row.user_id)),
      removed: new Set(removed.map((row) => row.user_id)),
    } as const;
  });
}

export interface StudioAccessPrincipalRef {
  type: StudioAccessPrincipalType;
  id: string;
}

export function studioAccessPrincipalKey(principal: StudioAccessPrincipalRef) {
  return `${principal.type}:${principal.id}`;
}

export type ChangeStudioAccessPolicyAttachmentsResult =
  { status: 'not_found' } | { status: 'ok'; attached: Set<string>; detached: Set<string> };

/** 割り当て・解除を 1 トランザクションで適用し、実際に変わった principal(`type:id`)を返す。 */
export async function changeStudioAccessPolicyAttachments(
  prisma: PrismaClient,
  input: {
    guildId: string;
    policyId: string;
    attach: readonly StudioAccessPrincipalRef[];
    detach: readonly StudioAccessPrincipalRef[];
    actorId: string;
  },
): Promise<ChangeStudioAccessPolicyAttachmentsResult> {
  const policyId = input.policyId.toLowerCase();

  return prisma.$transaction(async (tx) => {
    const policy = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM studio_access_policies
      WHERE guild_id = ${input.guildId} AND id = ${policyId}::uuid
      FOR SHARE
    `;
    if (policy.length === 0) return { status: 'not_found' } as const;

    const attached =
      input.attach.length === 0
        ? []
        : await tx.$queryRaw<Array<{ principal_type: string; principal_id: string }>>`
            INSERT INTO studio_access_policy_attachments
              (id, policy_id, guild_id, principal_type, principal_id, created_by)
            SELECT i.id, ${policyId}::uuid, ${input.guildId}, i.principal_type, i.principal_id, ${input.actorId}
            FROM unnest(
              ${input.attach.map(() => randomUUID())}::uuid[],
              ${input.attach.map((principal) => principal.type)}::text[],
              ${input.attach.map((principal) => principal.id)}::text[]
            ) AS i(id, principal_type, principal_id)
            ON CONFLICT (policy_id, principal_type, principal_id) DO NOTHING
            RETURNING principal_type, principal_id
          `;
    const detached =
      input.detach.length === 0
        ? []
        : await tx.$queryRaw<Array<{ principal_type: string; principal_id: string }>>`
            DELETE FROM studio_access_policy_attachments a
            USING unnest(
              ${input.detach.map((principal) => principal.type)}::text[],
              ${input.detach.map((principal) => principal.id)}::text[]
            ) AS d(principal_type, principal_id)
            WHERE a.guild_id = ${input.guildId}
              AND a.policy_id = ${policyId}::uuid
              AND a.principal_type = d.principal_type
              AND a.principal_id = d.principal_id
            RETURNING a.principal_type, a.principal_id
          `;

    const key = (row: { principal_type: string; principal_id: string }) =>
      `${row.principal_type}:${row.principal_id}`;
    return {
      status: 'ok',
      attached: new Set(attached.map(key)),
      detached: new Set(detached.map(key)),
    } as const;
  });
}
