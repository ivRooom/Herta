import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export const STUDIO_ACCESS_PRINCIPAL_TYPES = ['role', 'user', 'group'] as const;
export type StudioAccessPrincipalType = (typeof STUDIO_ACCESS_PRINCIPAL_TYPES)[number];

export interface ManagedStudioAccessPolicyRecord {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  document: Prisma.JsonValue;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudioAccessPolicyAttachmentRecord {
  id: string;
  policyId: string;
  guildId: string;
  principalType: StudioAccessPrincipalType;
  principalId: string;
  createdBy: string;
  createdAt: Date;
}

export interface StudioAccessGroupRecord {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PolicyRow {
  id: string;
  guild_id: string;
  name: string;
  description: string | null;
  document: Prisma.JsonValue;
  revision: number;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

interface AttachmentRow {
  id: string;
  policy_id: string;
  guild_id: string;
  principal_type: string;
  principal_id: string;
  created_by: string;
  created_at: Date;
}

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

interface EffectivePolicyRow {
  document: Prisma.JsonValue;
}

export async function listManagedStudioAccessPolicies(
  prisma: PrismaClient,
  guildId: string,
): Promise<ManagedStudioAccessPolicyRecord[]> {
  const rows = await prisma.$queryRaw<PolicyRow[]>`
    SELECT id, guild_id, name, description, document, revision,
           created_by, updated_by, created_at, updated_at
    FROM studio_access_policies
    WHERE guild_id = ${guildId}
    ORDER BY lower(name), id
  `;
  return rows.map(mapPolicyRow);
}

export async function findManagedStudioAccessPolicy(
  prisma: PrismaClient,
  guildId: string,
  policyId: string,
): Promise<ManagedStudioAccessPolicyRecord | null> {
  const rows = await prisma.$queryRaw<PolicyRow[]>`
    SELECT id, guild_id, name, description, document, revision,
           created_by, updated_by, created_at, updated_at
    FROM studio_access_policies
    WHERE guild_id = ${guildId} AND id = ${policyId}::uuid
    LIMIT 1
  `;
  return rows[0] ? mapPolicyRow(rows[0]) : null;
}

export async function createManagedStudioAccessPolicy(
  prisma: PrismaClient,
  input: {
    guildId: string;
    name: string;
    description: string | null;
    document: Prisma.InputJsonValue;
    actorId: string;
  },
): Promise<ManagedStudioAccessPolicyRecord> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<PolicyRow[]>`
    INSERT INTO studio_access_policies
      (id, guild_id, name, description, document, revision, created_by, updated_by)
    VALUES
      (${id}::uuid, ${input.guildId}, ${input.name}, ${input.description},
       ${JSON.stringify(input.document)}::jsonb, 1, ${input.actorId}, ${input.actorId})
    RETURNING id, guild_id, name, description, document, revision,
              created_by, updated_by, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('Studio access policy creation returned no row');
  return mapPolicyRow(row);
}

export async function updateManagedStudioAccessPolicy(
  prisma: PrismaClient,
  input: {
    guildId: string;
    policyId: string;
    name: string;
    description: string | null;
    document: Prisma.InputJsonValue;
    actorId: string;
  },
): Promise<ManagedStudioAccessPolicyRecord | null> {
  const rows = await prisma.$queryRaw<PolicyRow[]>`
    UPDATE studio_access_policies
    SET name = ${input.name},
        description = ${input.description},
        document = ${JSON.stringify(input.document)}::jsonb,
        revision = revision + 1,
        updated_by = ${input.actorId},
        updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ${input.guildId} AND id = ${input.policyId}::uuid
    RETURNING id, guild_id, name, description, document, revision,
              created_by, updated_by, created_at, updated_at
  `;
  return rows[0] ? mapPolicyRow(rows[0]) : null;
}

export async function deleteManagedStudioAccessPolicy(
  prisma: PrismaClient,
  guildId: string,
  policyId: string,
): Promise<boolean> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM studio_access_policies
    WHERE guild_id = ${guildId} AND id = ${policyId}::uuid
  `;
  return deleted > 0;
}

export async function listStudioAccessPolicyAttachments(
  prisma: PrismaClient,
  guildId: string,
): Promise<StudioAccessPolicyAttachmentRecord[]> {
  const rows = await prisma.$queryRaw<AttachmentRow[]>`
    SELECT a.id, a.policy_id, a.guild_id, a.principal_type, a.principal_id,
           a.created_by, a.created_at
    FROM studio_access_policy_attachments a
    INNER JOIN studio_access_policies p
      ON p.id = a.policy_id AND p.guild_id = a.guild_id
    WHERE a.guild_id = ${guildId}
    ORDER BY a.created_at, a.id
  `;
  return rows.flatMap((row) => {
    if (!isStudioAccessPrincipalType(row.principal_type)) return [];
    return [
      {
        id: row.id,
        policyId: row.policy_id,
        guildId: row.guild_id,
        principalType: row.principal_type,
        principalId: row.principal_id,
        createdBy: row.created_by,
        createdAt: row.created_at,
      },
    ];
  });
}

export async function attachStudioAccessPolicy(
  prisma: PrismaClient,
  input: {
    guildId: string;
    policyId: string;
    principalType: StudioAccessPrincipalType;
    principalId: string;
    actorId: string;
  },
): Promise<boolean> {
  const id = randomUUID();
  const inserted = await prisma.$executeRaw`
    INSERT INTO studio_access_policy_attachments
      (id, policy_id, guild_id, principal_type, principal_id, created_by)
    SELECT ${id}::uuid, p.id, p.guild_id, ${input.principalType}, ${input.principalId}, ${input.actorId}
    FROM studio_access_policies p
    WHERE p.id = ${input.policyId}::uuid AND p.guild_id = ${input.guildId}
    ON CONFLICT (policy_id, principal_type, principal_id) DO NOTHING
  `;
  return inserted > 0;
}

export async function detachStudioAccessPolicy(
  prisma: PrismaClient,
  input: {
    guildId: string;
    policyId: string;
    principalType: StudioAccessPrincipalType;
    principalId: string;
  },
): Promise<boolean> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM studio_access_policy_attachments a
    USING studio_access_policies p
    WHERE a.policy_id = p.id
      AND a.guild_id = ${input.guildId}
      AND p.guild_id = ${input.guildId}
      AND a.policy_id = ${input.policyId}::uuid
      AND a.principal_type = ${input.principalType}
      AND a.principal_id = ${input.principalId}
  `;
  return deleted > 0;
}

export async function listEffectiveStudioAccessPolicyDocuments(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<Prisma.JsonValue[]> {
  const rolePredicate =
    roleIds.length === 0
      ? Prisma.sql`FALSE`
      : Prisma.sql`(a.principal_type = 'role' AND a.principal_id IN (${Prisma.join(roleIds)}))`;
  const rows = await prisma.$queryRaw<EffectivePolicyRow[]>(Prisma.sql`
    SELECT DISTINCT p.id, p.document
    FROM studio_access_policies p
    INNER JOIN studio_access_policy_attachments a
      ON a.policy_id = p.id AND a.guild_id = p.guild_id
    WHERE p.guild_id = ${guildId}
      AND (
        (a.principal_type = 'user' AND a.principal_id = ${userId})
        OR ${rolePredicate}
        OR (
          a.principal_type = 'group'
          AND EXISTS (
            SELECT 1
            FROM studio_access_group_members gm
            WHERE gm.guild_id = ${guildId}
              AND gm.user_id = ${userId}
              AND gm.group_id::text = a.principal_id
          )
        )
      )
    ORDER BY p.id
  `);
  return rows.map((row) => row.document);
}

export async function listStudioAccessGroups(
  prisma: PrismaClient,
  guildId: string,
): Promise<StudioAccessGroupRecord[]> {
  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT id, guild_id, name, description, created_by, updated_by, created_at, updated_at
    FROM studio_access_groups
    WHERE guild_id = ${guildId}
    ORDER BY lower(name), id
  `;
  return rows.map(mapGroupRow);
}

export async function createStudioAccessGroup(
  prisma: PrismaClient,
  input: {
    guildId: string;
    name: string;
    description: string | null;
    actorId: string;
  },
): Promise<StudioAccessGroupRecord> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<GroupRow[]>`
    INSERT INTO studio_access_groups
      (id, guild_id, name, description, created_by, updated_by)
    VALUES
      (${id}::uuid, ${input.guildId}, ${input.name}, ${input.description}, ${input.actorId}, ${input.actorId})
    RETURNING id, guild_id, name, description, created_by, updated_by, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('Studio access group creation returned no row');
  return mapGroupRow(row);
}

export async function addStudioAccessGroupMember(
  prisma: PrismaClient,
  input: { guildId: string; groupId: string; userId: string; actorId: string },
): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO studio_access_group_members (group_id, guild_id, user_id, created_by)
    SELECT g.id, g.guild_id, ${input.userId}, ${input.actorId}
    FROM studio_access_groups g
    WHERE g.id = ${input.groupId}::uuid AND g.guild_id = ${input.guildId}
    ON CONFLICT (group_id, user_id) DO NOTHING
  `;
  return inserted > 0;
}

export async function removeStudioAccessGroupMember(
  prisma: PrismaClient,
  input: { guildId: string; groupId: string; userId: string },
): Promise<boolean> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM studio_access_group_members gm
    USING studio_access_groups g
    WHERE gm.group_id = g.id
      AND gm.guild_id = ${input.guildId}
      AND g.guild_id = ${input.guildId}
      AND gm.group_id = ${input.groupId}::uuid
      AND gm.user_id = ${input.userId}
  `;
  return deleted > 0;
}

export function isStudioAccessPrincipalType(value: string): value is StudioAccessPrincipalType {
  return (STUDIO_ACCESS_PRINCIPAL_TYPES as readonly string[]).includes(value);
}

function mapPolicyRow(row: PolicyRow): ManagedStudioAccessPolicyRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    document: row.document,
    revision: row.revision,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
