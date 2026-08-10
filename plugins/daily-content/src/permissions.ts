export const DISCORD_VIEW_CHANNEL = 1n << 10n;
export const DISCORD_SEND_MESSAGES = 1n << 11n;
export const DISCORD_ADMINISTRATOR = 1n << 3n;
export const DISCORD_MANAGE_THREADS = 1n << 34n;
export const DISCORD_SEND_MESSAGES_IN_THREADS = 1n << 38n;

export interface DiscordPermissionRole {
  id: string;
  permissions: string;
}

export interface DiscordPermissionMember {
  userId: string;
  roleIds: string[];
}

export interface DiscordPermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface DiscordPermissionInput {
  guildId: string;
  roles: DiscordPermissionRole[];
  member: DiscordPermissionMember;
  overwrites: DiscordPermissionOverwrite[];
}

export interface DailyContentPermissionCheck {
  allowed: boolean;
  permissions: bigint;
  missing: Array<'VIEW_CHANNEL' | 'SEND_MESSAGES' | 'SEND_MESSAGES_IN_THREADS'>;
}

/** Discord公式のbase permission → everyone → roles → member overwrite順で計算する。 */
export function computeDiscordChannelPermissions(input: DiscordPermissionInput): bigint {
  const everyone = input.roles.find((role) => role.id === input.guildId);
  let permissions = parsePermissionBits(everyone?.permissions);

  for (const roleId of input.member.roleIds) {
    const role = input.roles.find((candidate) => candidate.id === roleId);
    permissions |= parsePermissionBits(role?.permissions);
  }

  if ((permissions & DISCORD_ADMINISTRATOR) === DISCORD_ADMINISTRATOR) {
    return ~0n;
  }

  const everyoneOverwrite = input.overwrites.find(
    (overwrite) => overwrite.type === 0 && overwrite.id === input.guildId,
  );
  permissions = applyOverwrite(permissions, everyoneOverwrite);

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type !== 0 || !input.member.roleIds.includes(overwrite.id)) continue;
    roleAllow |= parsePermissionBits(overwrite.allow);
    roleDeny |= parsePermissionBits(overwrite.deny);
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = input.overwrites.find(
    (overwrite) => overwrite.type === 1 && overwrite.id === input.member.userId,
  );
  return applyOverwrite(permissions, memberOverwrite);
}

export function checkDailyContentSendPermissions(
  permissions: bigint,
  isThread: boolean,
): DailyContentPermissionCheck {
  const missing: DailyContentPermissionCheck['missing'] = [];
  if ((permissions & DISCORD_VIEW_CHANNEL) !== DISCORD_VIEW_CHANNEL) {
    missing.push('VIEW_CHANNEL');
  }
  const sendPermission = isThread ? DISCORD_SEND_MESSAGES_IN_THREADS : DISCORD_SEND_MESSAGES;
  if ((permissions & sendPermission) !== sendPermission) {
    missing.push(isThread ? 'SEND_MESSAGES_IN_THREADS' : 'SEND_MESSAGES');
  }
  return { allowed: missing.length === 0, permissions, missing };
}

/** Archived Threadを再開できるDiscord権限か判定する。 */
export function canManageDailyContentThreads(permissions: bigint): boolean {
  return (
    (permissions & DISCORD_ADMINISTRATOR) === DISCORD_ADMINISTRATOR ||
    (permissions & DISCORD_MANAGE_THREADS) === DISCORD_MANAGE_THREADS
  );
}

function applyOverwrite(
  permissions: bigint,
  overwrite: DiscordPermissionOverwrite | undefined,
): bigint {
  if (!overwrite) return permissions;
  permissions &= ~parsePermissionBits(overwrite.deny);
  permissions |= parsePermissionBits(overwrite.allow);
  return permissions;
}

function parsePermissionBits(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
