import {
  listManagedStudioAccessPolicies,
  listStudioAccessGroupMembers,
  listStudioAccessGroups,
  listStudioAccessPolicyAttachments,
} from '@herta/db';
import { getGuildConfigurationOptions } from './bot-guild-options.ts';
import { prisma } from './db.ts';
import { listGuildPlugins } from './guild-plugins.ts';
import {
  STUDIO_ROOT_DISCORD_ROLE_ID,
  validateStudioAccessPolicy,
  type StudioAccessPolicy,
} from './studio-access-policy.ts';
import { listStudioRolePolicies } from './studio-role-policy-store.ts';

export interface StudioAccessInventoryPolicy {
  id: string;
  name: string;
  description: string | null;
  policy: StudioAccessPolicy;
  revision: number;
  updatedAt: string;
}

export async function loadStudioAccessInventory(guildId: string) {
  const options = await getGuildConfigurationOptions(guildId);
  if (!options) return null;

  const [storedPolicies, attachments, groups, groupMembers, legacyRolePolicies, plugins] =
    await Promise.all([
      listManagedStudioAccessPolicies(prisma, guildId),
      listStudioAccessPolicyAttachments(prisma, guildId),
      listStudioAccessGroups(prisma, guildId),
      listStudioAccessGroupMembers(prisma, guildId),
      listStudioRolePolicies(guildId),
      listGuildPlugins(guildId),
    ]);

  const policies: StudioAccessInventoryPolicy[] = [];
  let invalidPolicyCount = 0;
  for (const stored of storedPolicies) {
    const validation = validateStudioAccessPolicy(stored.document, guildId);
    if (!validation.valid || !validation.policy) {
      invalidPolicyCount += 1;
      continue;
    }
    policies.push({
      id: stored.id,
      name: stored.name,
      description: stored.description,
      policy: validation.policy,
      revision: stored.revision,
      updatedAt: stored.updatedAt.toISOString(),
    });
  }

  const userIds = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.principalType === 'user') userIds.add(attachment.principalId);
  }
  for (const member of groupMembers) userIds.add(member.userId);

  const guildMembers =
    userIds.size === 0
      ? []
      : await prisma.guildMember.findMany({
          where: { guildId, userId: { in: [...userIds] } },
          include: { user: true },
        });
  const guildMemberById = new Map(guildMembers.map((member) => [member.userId, member]));

  const users = [...userIds]
    .map((userId) => {
      const membership = guildMemberById.get(userId);
      return {
        id: userId,
        username: membership?.user.username ?? null,
        nickname: membership?.nickname ?? null,
        avatar: membership?.user.avatar ?? null,
        roleIds: membership?.roles ?? [],
      };
    })
    .sort((left, right) => {
      const leftName = left.nickname || left.username || left.id;
      const rightName = right.nickname || right.username || right.id;
      return leftName.localeCompare(rightName, 'ja', { sensitivity: 'base' });
    });

  return {
    guildName: options.guildName,
    policies,
    storedPolicyCount: storedPolicies.length,
    invalidPolicyCount,
    attachments,
    groups,
    groupMembers,
    users,
    roles: options.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      managed: role.managed,
      editable: role.editable,
      root: role.id === STUDIO_ROOT_DISCORD_ROLE_ID,
    })),
    roleOptions: options.roles
      .filter((role) => role.id !== STUDIO_ROOT_DISCORD_ROLE_ID)
      .map((role) => ({ id: role.id, name: role.name })),
    legacyRolePolicyCount: legacyRolePolicies.length,
    plugins: plugins.map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      configSchema: plugin.manifest.configSchema,
    })),
  };
}
