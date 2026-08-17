import { PermissionFlagsBits, type Client, type Role } from 'discord.js';
import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';

const ROLE_NAME_MAX_LENGTH = 100;
const MAX_ROLE_COLOR = 0xffffff;

export interface GuildRoleCreateInput {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
}

export interface GuildRoleMutationResult {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  editable: boolean;
}

export class GuildRoleLifecycleError extends Error {
  constructor(
    readonly code:
      | 'guild_not_found'
      | 'manage_roles_required'
      | 'role_not_found'
      | 'role_protected'
      | 'role_managed'
      | 'role_not_editable'
      | 'discord_role_mutation_failed',
    readonly status: number,
  ) {
    super(code);
    this.name = 'GuildRoleLifecycleError';
  }
}

export function parseGuildRoleCreateInput(value: unknown): GuildRoleCreateInput | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const color = typeof value.color === 'number' ? value.color : Number.NaN;
  if (!name || name.length > ROLE_NAME_MAX_LENGTH) return null;
  if (!Number.isInteger(color) || color < 0 || color > MAX_ROLE_COLOR) return null;
  if (typeof value.hoist !== 'boolean' || typeof value.mentionable !== 'boolean') return null;
  return { name, color, hoist: value.hoist, mentionable: value.mentionable };
}

export function assertRoleCanBeDeleted(role: {
  id: string;
  guildId: string;
  managed: boolean;
  editable: boolean;
}): void {
  if (role.id === role.guildId || role.id === STUDIO_ROOT_DISCORD_ROLE_ID) {
    throw new GuildRoleLifecycleError('role_protected', 409);
  }
  if (role.managed) throw new GuildRoleLifecycleError('role_managed', 409);
  if (!role.editable) throw new GuildRoleLifecycleError('role_not_editable', 409);
}

export async function createGuildRole(
  client: Client,
  guildId: string,
  input: GuildRoleCreateInput,
): Promise<GuildRoleMutationResult> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new GuildRoleLifecycleError('guild_not_found', 404);
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new GuildRoleLifecycleError('manage_roles_required', 403);
  }

  try {
    const role = await guild.roles.create({
      name: input.name,
      color: input.color,
      hoist: input.hoist,
      mentionable: input.mentionable,
      permissions: 0n,
      reason: 'Herta Studio Role Manager',
    });
    return toMutationResult(role);
  } catch (error) {
    if (error instanceof GuildRoleLifecycleError) throw error;
    throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  }
}

export async function deleteGuildRole(
  client: Client,
  guildId: string,
  roleId: string,
): Promise<{ deleted: boolean; roleName: string | null }> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new GuildRoleLifecycleError('guild_not_found', 404);
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new GuildRoleLifecycleError('manage_roles_required', 403);
  }

  let role: Role | null;
  try {
    role = await guild.roles.fetch(roleId);
  } catch {
    role = null;
  }
  if (!role) return { deleted: false, roleName: null };
  assertRoleCanBeDeleted({
    id: role.id,
    guildId: guild.id,
    managed: role.managed,
    editable: role.editable,
  });

  const roleName = role.name;
  try {
    await role.delete('Herta Studio Role Manager');
    return { deleted: true, roleName };
  } catch (error) {
    if (error instanceof GuildRoleLifecycleError) throw error;
    throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  }
}

function toMutationResult(role: Role): GuildRoleMutationResult {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    managed: role.managed,
    mentionable: role.mentionable,
    editable: role.editable,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
