export const DISCORD_ROLE_NAME_MAX_LENGTH = 100;
export const DISCORD_ROLE_EXPIRY_MIN_SECONDS = 60;
export const DISCORD_ROLE_EXPIRY_MAX_SECONDS = 31_536_000;
export const DISCORD_ROLE_SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1_000;

const DISCORD_ID_PATTERN = /^\d{17,20}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const ROLE_NAME_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const ALLOWED_CREATE_KEYS = new Set(['name', 'color', 'scheduledFor', 'expiresAfterSeconds']);

export interface DiscordRoleCreateRequest {
  name: string;
  color: number;
  scheduledFor: Date;
  expiresAfterSeconds: number | null;
}

export function parseDiscordRoleCreateRequest(
  value: unknown,
  now = new Date(),
): DiscordRoleCreateRequest | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !ALLOWED_CREATE_KEYS.has(key))) return null;

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (
    !name ||
    name.length > DISCORD_ROLE_NAME_MAX_LENGTH ||
    ROLE_NAME_CONTROL_CHARACTER_PATTERN.test(name)
  ) {
    return null;
  }

  const color = parseDiscordRoleColor(value.color);
  if (color === null) return null;

  const scheduledFor = parseScheduledFor(value.scheduledFor, now);
  if (!scheduledFor) return null;

  const expiresAfterSeconds = parseExpirySeconds(value.expiresAfterSeconds);
  if (expiresAfterSeconds === undefined) return null;

  return { name, color, scheduledFor, expiresAfterSeconds };
}

export function parseDiscordRoleColor(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : null;
  }
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value.trim())) return null;
  return Number.parseInt(value.trim().slice(1), 16);
}

export function formatDiscordRoleColor(value: number): string {
  const safe = Number.isInteger(value) ? Math.max(0, Math.min(0xffffff, value)) : 0;
  return `#${safe.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function isDiscordRoleId(value: string): boolean {
  return DISCORD_ID_PATTERN.test(value);
}

export function isRoleOperationId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function roleDeleteBlockReason(
  role: { id: string; managed: boolean; editable: boolean },
  rootRoleId: string,
): 'root' | 'managed' | 'hierarchy' | null {
  if (role.id === rootRoleId) return 'root';
  if (role.managed) return 'managed';
  if (!role.editable) return 'hierarchy';
  return null;
}

function parseScheduledFor(value: unknown, now: Date): Date | null {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (value === undefined || value === null || value === '') return new Date(now);
  if (typeof value !== 'string' || value.length > 64) return null;
  const scheduledFor = new Date(value);
  if (Number.isNaN(scheduledFor.getTime())) return null;
  if (scheduledFor.getTime() < now.getTime() - 30_000) return null;
  if (scheduledFor.getTime() > now.getTime() + DISCORD_ROLE_SCHEDULE_MAX_AHEAD_MS) return null;
  return scheduledFor;
}

function parseExpirySeconds(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < DISCORD_ROLE_EXPIRY_MIN_SECONDS || value > DISCORD_ROLE_EXPIRY_MAX_SECONDS) {
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
