export const XP_ROLE_RECONCILIATION_EVENT_CHANNEL = 'herta:xp-role-reconciliation:v1';
export const XP_ROLE_RECONCILIATION_EVENT_SCHEMA_VERSION = 1 as const;

export interface XpRoleReconciliationEvent {
  schemaVersion: typeof XP_ROLE_RECONCILIATION_EVENT_SCHEMA_VERSION;
  eventId: string;
  guildId: string;
  userId: string;
  reason: 'xp_admin';
  occurredAt: string;
}

export function createXpRoleReconciliationEvent(input: {
  guildId: string;
  userId: string;
  occurredAt?: Date;
}): XpRoleReconciliationEvent {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    schemaVersion: XP_ROLE_RECONCILIATION_EVENT_SCHEMA_VERSION,
    eventId: `${input.guildId}:${input.userId}:${occurredAt}`,
    guildId: input.guildId,
    userId: input.userId,
    reason: 'xp_admin',
    occurredAt,
  };
}

export function parseXpRoleReconciliationEvent(
  value: string,
): XpRoleReconciliationEvent | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!isRecord(candidate)) return undefined;
  if (candidate.schemaVersion !== XP_ROLE_RECONCILIATION_EVENT_SCHEMA_VERSION) return undefined;
  if (!isNonEmptyString(candidate.eventId)) return undefined;
  if (!isDiscordId(candidate.guildId) || !isDiscordId(candidate.userId)) return undefined;
  if (candidate.reason !== 'xp_admin') return undefined;
  if (!isNonEmptyString(candidate.occurredAt) || Number.isNaN(Date.parse(candidate.occurredAt))) {
    return undefined;
  }
  return candidate as unknown as XpRoleReconciliationEvent;
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
