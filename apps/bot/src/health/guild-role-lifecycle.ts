import { STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const ROLE_NAME_MAX_LENGTH = 100;
const MAX_ROLE_COLOR = 0xffffff;
const MANAGE_ROLES_PERMISSION = 1n << 28n;
const ADMINISTRATOR_PERMISSION = 1n << 3n;

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

interface DiscordRolePayload {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

interface DiscordUserPayload {
  id: string;
}

interface DiscordGuildMemberPayload {
  roles?: string[];
}

export class GuildRoleLifecycleError extends Error {
  constructor(
    readonly code:
      | 'guild_not_found'
      | 'manage_roles_required'
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
  token: string,
  guildId: string,
  input: GuildRoleCreateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildRoleMutationResult> {
  const context = await loadPermissionContext(token, guildId, fetchImpl);
  assertManageRoles(context.permissions);

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
    method: 'POST',
    headers: discordHeaders(token, true),
    body: JSON.stringify({
      name: input.name,
      color: input.color,
      hoist: input.hoist,
      mentionable: input.mentionable,
      permissions: '0',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await mutationError(response);
  const role = parseDiscordRole(await response.json().catch(() => null));
  if (!role) throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  return toMutationResult(role, context.highestRolePosition);
}

export async function deleteGuildRole(
  token: string,
  guildId: string,
  roleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ deleted: boolean; roleName: string | null }> {
  const context = await loadPermissionContext(token, guildId, fetchImpl);
  assertManageRoles(context.permissions);
  const role = context.roles.find((candidate) => candidate.id === roleId);
  if (!role) return { deleted: false, roleName: null };
  assertRoleCanBeDeleted({
    id: role.id,
    guildId,
    managed: role.managed,
    editable: role.position < context.highestRolePosition,
  });

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: discordHeaders(token, false),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { deleted: false, roleName: role.name };
  if (!response.ok) throw await mutationError(response);
  return { deleted: true, roleName: role.name };
}

async function loadPermissionContext(
  token: string,
  guildId: string,
  fetchImpl: typeof fetch,
): Promise<{ roles: DiscordRolePayload[]; permissions: bigint; highestRolePosition: number }> {
  const [userResponse, rolesResponse] = await Promise.all([
    fetchImpl(`${DISCORD_API_BASE_URL}/users/@me`, {
      headers: discordHeaders(token, false),
      signal: AbortSignal.timeout(10_000),
    }),
    fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
      headers: discordHeaders(token, false),
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  if (rolesResponse.status === 404) throw new GuildRoleLifecycleError('guild_not_found', 404);
  if (!userResponse.ok || !rolesResponse.ok) throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);

  const user = (await userResponse.json().catch(() => null)) as DiscordUserPayload | null;
  const rawRoles = await rolesResponse.json().catch(() => null);
  if (!user || !/^\d+$/u.test(user.id) || !Array.isArray(rawRoles)) {
    throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  }
  const roles = rawRoles.flatMap((value) => {
    const role = parseDiscordRole(value);
    return role ? [role] : [];
  });
  const memberResponse = await fetchImpl(
    `${DISCORD_API_BASE_URL}/guilds/${guildId}/members/${user.id}`,
    {
      headers: discordHeaders(token, false),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (memberResponse.status === 404) throw new GuildRoleLifecycleError('guild_not_found', 404);
  if (!memberResponse.ok) throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  const member = (await memberResponse.json().catch(() => null)) as DiscordGuildMemberPayload | null;
  if (!member || !Array.isArray(member.roles)) {
    throw new GuildRoleLifecycleError('discord_role_mutation_failed', 503);
  }

  const memberRoleIds = new Set([guildId, ...member.roles]);
  let permissions = 0n;
  let highestRolePosition = 0;
  for (const role of roles) {
    if (!memberRoleIds.has(role.id)) continue;
    permissions |= safePermissionBits(role.permissions);
    highestRolePosition = Math.max(highestRolePosition, role.position);
  }
  return { roles, permissions, highestRolePosition };
}

function assertManageRoles(permissions: bigint): void {
  if (
    (permissions & ADMINISTRATOR_PERMISSION) !== ADMINISTRATOR_PERMISSION &&
    (permissions & MANAGE_ROLES_PERMISSION) !== MANAGE_ROLES_PERMISSION
  ) {
    throw new GuildRoleLifecycleError('manage_roles_required', 403);
  }
}

function parseDiscordRole(value: unknown): DiscordRolePayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (typeof value.color !== 'number' || typeof value.position !== 'number') return null;
  if (typeof value.permissions !== 'string') return null;
  if (typeof value.managed !== 'boolean' || typeof value.mentionable !== 'boolean') return null;
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    position: value.position,
    permissions: value.permissions,
    managed: value.managed,
    mentionable: value.mentionable,
  };
}

function toMutationResult(role: DiscordRolePayload, highestRolePosition: number): GuildRoleMutationResult {
  return {
    id: role.id,
    name: role.name,
    color: `#${role.color.toString(16).padStart(6, '0')}`,
    position: role.position,
    managed: role.managed,
    mentionable: role.mentionable,
    editable: !role.managed && role.position < highestRolePosition,
  };
}

function safePermissionBits(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function discordHeaders(token: string, json: boolean): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'X-Audit-Log-Reason': encodeURIComponent('Herta Studio Role Manager'),
  };
}

async function mutationError(response: Response): Promise<GuildRoleLifecycleError> {
  if (response.status === 403) return new GuildRoleLifecycleError('manage_roles_required', 403);
  if (response.status === 404) return new GuildRoleLifecycleError('guild_not_found', 404);
  return new GuildRoleLifecycleError('discord_role_mutation_failed', response.status === 429 ? 429 : 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
