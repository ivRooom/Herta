import type { PrismaClient } from '@prisma/client';

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
