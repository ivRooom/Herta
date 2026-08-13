export const XP_ADMIN_DISCORD_ID_PATTERN = /^\d{5,30}$/;
export const XP_ADMIN_MAX_XP = 100_000_000;
export const XP_ADMIN_MAX_DELTA = 10_000_000;

export type XpAdminAction = 'add' | 'subtract' | 'set' | 'reset_user' | 'reset_guild';

export interface XpAdminRequest {
  action: XpAdminAction;
  userId: string | null;
  amount: number | null;
  reason: string | null;
  confirmation: string | null;
}

export interface XpAdminProfile {
  userId: string;
  xp: number;
  level: number;
  rank: number | null;
}

export interface XpAdminGuildSummary {
  profiles: number;
  totalXp: number;
  highestXp: number;
}

export interface XpAdminResult {
  action: XpAdminAction;
  changed: boolean;
  beforeXp: number | null;
  afterXp: number | null;
  beforeLevel: number | null;
  afterLevel: number | null;
  affectedProfiles: number;
  rewardRoleSyncRequired: boolean;
}

export class XpAdminValidationError extends Error {}

export function parseXpAdminRequest(value: unknown, guildId: string): XpAdminRequest | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null;
  const action = value.action as XpAdminAction;
  if (!['add', 'subtract', 'set', 'reset_user', 'reset_guild'].includes(action)) return null;

  const reason = normalizeOptionalString(value.reason, 240);
  const confirmation = normalizeOptionalString(value.confirmation, 120);

  if (action === 'reset_guild') {
    if (!reason || reason.length < 3) return null;
    if (confirmation !== `RESET ${guildId}`) return null;
    return { action, userId: null, amount: null, reason, confirmation };
  }

  const userId = typeof value.userId === 'string' ? value.userId.trim() : '';
  if (!XP_ADMIN_DISCORD_ID_PATTERN.test(userId)) return null;

  if (action === 'reset_user') {
    return { action, userId, amount: null, reason, confirmation: null };
  }

  const amount = toSafeInteger(value.amount);
  if (amount === null) return null;
  if (action === 'set') {
    if (amount < 0 || amount > XP_ADMIN_MAX_XP) return null;
  } else if (amount < 1 || amount > XP_ADMIN_MAX_DELTA) {
    return null;
  }

  return { action, userId, amount, reason, confirmation: null };
}

export function xpAdminLevelForXp(xp: number): number {
  return Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

export function nextXpAfterAdminAction(
  currentXp: number,
  action: Exclude<XpAdminAction, 'reset_user' | 'reset_guild'>,
  amount: number,
): number {
  const current = clampXp(currentXp);
  if (action === 'add') return clampXp(current + amount);
  if (action === 'subtract') return clampXp(current - amount);
  return clampXp(amount);
}

function clampXp(value: number): number {
  return Math.min(XP_ADMIN_MAX_XP, Math.max(0, Math.trunc(value)));
}

function toSafeInteger(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) return null;
  return number;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
