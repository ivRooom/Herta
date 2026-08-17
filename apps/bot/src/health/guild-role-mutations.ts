import { HERTA_STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const MAX_ROLE_NAME_LENGTH = 100;

export interface GuildRoleCreateInput {
  name: string;
  color: number;
  operationId: string;
}

export interface GuildRoleMutationResult {
  id: string;
  name: string;
  color: number;
}

interface DiscordRolePayload {
  id: string;
  name: string;
  color: number;
  managed: boolean;
}

export class GuildRoleMutationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'GuildRoleMutationError';
  }
}

export function parseGuildRoleCreateInput(value: unknown): GuildRoleCreateInput | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const color = typeof value.color === 'number' ? value.color : Number.NaN;
  const operationId = typeof value.operationId === 'string' ? value.operationId.trim() : '';
  if (!name || name.length > MAX_ROLE_NAME_LENGTH) return null;
  if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return null;
  if (!isUuid(operationId)) return null;
  return { name, color, operationId };
}

export async function createGuildRole(
  token: string,
  guildId: string,
  input: GuildRoleCreateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildRoleMutationResult> {
  assertGuildId(guildId);
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
    method: 'POST',
    headers: discordHeaders(token, `Herta Role Manager create ${input.operationId}`),
    body: JSON.stringify({
      name: input.name,
      color: input.color,
      permissions: '0',
      hoist: false,
      mentionable: false,
    }),
  });
  if (!response.ok) throw await toMutationError(response, 'role_create_failed');
  const role = parseDiscordRole(await response.json().catch(() => null));
  if (!role) throw new GuildRoleMutationError(502, 'malformed_discord_role_response');
  return { id: role.id, name: role.name, color: role.color };
}

export async function deleteGuildRole(
  token: string,
  guildId: string,
  roleId: string,
  operationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildRoleMutationResult | null> {
  assertGuildId(guildId);
  if (!DISCORD_ID_PATTERN.test(roleId)) {
    throw new GuildRoleMutationError(400, 'invalid_role_id');
  }
  if (!isUuid(operationId)) {
    throw new GuildRoleMutationError(400, 'invalid_operation_id');
  }
  if (roleId === guildId || roleId === HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) {
    throw new GuildRoleMutationError(403, 'protected_role');
  }

  const rolesResponse = await fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
    headers: discordHeaders(token),
    cache: 'no-store',
  });
  if (!rolesResponse.ok) throw await toMutationError(rolesResponse, 'role_lookup_failed');
  const rawRoles = await rolesResponse.json().catch(() => null);
  if (!Array.isArray(rawRoles)) {
    throw new GuildRoleMutationError(502, 'malformed_discord_roles_response');
  }
  const role = rawRoles.map(parseDiscordRole).find((candidate) => candidate?.id === roleId) ?? null;
  if (!role) return null;
  if (role.managed) throw new GuildRoleMutationError(409, 'managed_role');

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/guilds/${guildId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: discordHeaders(token, `Herta Role Manager delete ${operationId}`),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await toMutationError(response, 'role_delete_failed');
  return { id: role.id, name: role.name, color: role.color };
}

function discordHeaders(token: string, reason?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bot ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason.slice(0, 480));
  return headers;
}

async function toMutationError(response: Response, fallbackCode: string): Promise<GuildRoleMutationError> {
  const status = [400, 403, 404, 409, 429].includes(response.status) ? response.status : 503;
  return new GuildRoleMutationError(status, fallbackCode);
}

function parseDiscordRole(value: unknown): DiscordRolePayload | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name : '';
  const color = typeof value.color === 'number' ? value.color : Number.NaN;
  const managed = typeof value.managed === 'boolean' ? value.managed : false;
  if (!DISCORD_ID_PATTERN.test(id) || !name || !Number.isInteger(color)) return null;
  return { id, name, color, managed };
}

function assertGuildId(guildId: string): void {
  if (!DISCORD_ID_PATTERN.test(guildId)) {
    throw new GuildRoleMutationError(400, 'invalid_guild_id');
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
