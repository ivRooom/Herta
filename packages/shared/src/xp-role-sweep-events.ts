export const XP_ROLE_SWEEP_EVENT_CHANNEL = 'herta:xp-role-sweep:v1';
export const XP_ROLE_SWEEP_EVENT_SCHEMA_VERSION = 1 as const;

export type XpRoleSweepReason = 'xp_admin_reset_guild' | 'manual_repair';

export interface XpRoleSweepEvent {
  schemaVersion: typeof XP_ROLE_SWEEP_EVENT_SCHEMA_VERSION;
  eventId: string;
  requestId: string;
  guildId: string;
  actorId: string;
  reason: XpRoleSweepReason;
  occurredAt: string;
}

export function createXpRoleSweepEvent(input: {
  requestId: string;
  guildId: string;
  actorId: string;
  reason: XpRoleSweepReason;
  occurredAt?: Date;
}): XpRoleSweepEvent {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    schemaVersion: XP_ROLE_SWEEP_EVENT_SCHEMA_VERSION,
    eventId: `${input.guildId}:${input.requestId}:${occurredAt}`,
    requestId: input.requestId,
    guildId: input.guildId,
    actorId: input.actorId,
    reason: input.reason,
    occurredAt,
  };
}

export function parseXpRoleSweepEvent(value: string): XpRoleSweepEvent | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!isRecord(candidate)) return undefined;
  if (candidate.schemaVersion !== XP_ROLE_SWEEP_EVENT_SCHEMA_VERSION) return undefined;
  if (!isNonEmptyString(candidate.eventId)) return undefined;
  if (!isRequestId(candidate.requestId)) return undefined;
  if (!isDiscordId(candidate.guildId)) return undefined;
  if (!isNonEmptyString(candidate.actorId) || candidate.actorId.length > 128) return undefined;
  if (!isXpRoleSweepReason(candidate.reason)) return undefined;
  if (!isNonEmptyString(candidate.occurredAt) || Number.isNaN(Date.parse(candidate.occurredAt))) {
    return undefined;
  }
  return candidate as unknown as XpRoleSweepEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,30}$/u.test(value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isXpRoleSweepReason(value: unknown): value is XpRoleSweepReason {
  return value === 'xp_admin_reset_guild' || value === 'manual_repair';
}
