import type { PrismaClient } from '@prisma/client';
import type { StudioAccessGroupRecord } from './studio-access-control.js';

export interface StudioAccessGroupMemberRecord {
  groupId: string;
  guildId: string;
  userId: string;
  createdBy: string;
  createdAt: Date;
}

interface GroupMemberRow {
  group_id: string;
  guild_id: string;
  user_id: string;
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

export async function listStudioAccessGroupMembers(
  prisma: PrismaClient,
  guildId: string,
): Promise<StudioAccessGroupMemberRecord[]> {
  const rows = await prisma.$queryRaw<GroupMemberRow[]>`
    SELECT gm.group_id, gm.guild_id, gm.user_id, gm.created_by, gm.created_at
    FROM studio_access_group_members gm
    INNER JOIN studio_access_groups g
      ON g.id = gm.group_id AND g.guild_id = gm.guild_id
    WHERE gm.guild_id = ${guildId}
    ORDER BY gm.created_at, gm.group_id, gm.user_id
  `;
  return rows.map((row) => ({
    groupId: row.group_id,
    guildId: row.guild_id,
    userId: row.user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function createStudioAccessGroupWithId(
  prisma: PrismaClient,
  input: {
    id: string;
    guildId: string;
    name: string;
    description: string | null;
    actorId: string;
  },
): Promise<StudioAccessGroupRecord> {
  const rows = await prisma.$queryRaw<GroupRow[]>`
    INSERT INTO studio_access_groups
      (id, guild_id, name, description, created_by, updated_by)
    VALUES
      (${input.id.toLowerCase()}::uuid, ${input.guildId}, ${input.name}, ${input.description}, ${input.actorId}, ${input.actorId})
    RETURNING id, guild_id, name, description, created_by, updated_by, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('Studio access group creation returned no row');
  return mapGroupRow(row);
}

export async function updateStudioAccessGroup(
  prisma: PrismaClient,
  input: {
    guildId: string;
    groupId: string;
    name: string;
    description: string | null;
    actorId: string;
  },
): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE studio_access_groups
    SET name = ${input.name},
        description = ${input.description},
        updated_by = ${input.actorId},
        updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ${input.guildId} AND id = ${input.groupId.toLowerCase()}::uuid
  `;
  return updated > 0;
}

export async function deleteStudioAccessGroup(
  prisma: PrismaClient,
  guildId: string,
  groupId: string,
): Promise<boolean> {
  const canonicalGroupId = groupId.toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM studio_access_policy_attachments
      WHERE guild_id = ${guildId}
        AND principal_type = 'group'
        AND principal_id = ${canonicalGroupId}
    `;
    const deleted = await tx.$executeRaw`
      DELETE FROM studio_access_groups
      WHERE guild_id = ${guildId} AND id = ${canonicalGroupId}::uuid
    `;
    return deleted > 0;
  });
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
