import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRequestBodyBytes } from './bounded-request-body.ts';
export const BIRTHDAY_DELIVERY_HISTORY_PATH = '/api/ivrm/birthday-deliveries/read';
export const BIRTHDAY_DELIVERY_HISTORY_PURPOSE = 'herta-birthday-deliveries-read-v1';
export interface BirthdayDeliveryHistoryInput {
  guildId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
}
/**
 * The delivery categories the Admin history tab renders. The
 * stored `kind` column carries the role id as a suffix
 * (`role-assigned:<roleId>`); the wire only ever carries the
 * category, never the raw kind, so internal idempotency
 * structure does not leak into the Admin surface (#1572 S5b).
 */
export type BirthdayDeliveryCategory = 'card' | 'role_assign' | 'role_remove' | 'other';
export interface BirthdayDeliveryHistoryItem {
  date: string;
  discordUserId: string;
  category: BirthdayDeliveryCategory;
  status: string;
  errorSummary: string | null;
  completedAt: string | null;
  createdAt: string;
}
export function categorizeBirthdayDeliveryKind(kind: unknown): BirthdayDeliveryCategory {
  if (kind === 'announcement') return 'card';
  if (typeof kind === 'string' && kind.startsWith('role-assigned:')) return 'role_assign';
  if (typeof kind === 'string' && kind.startsWith('role-removed:')) return 'role_remove';
  return 'other';
}
const DELIVERY_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
/**
 * The stored error_name is an error class name written by the
 * bot (e.g. `DiscordAPIError`, `StaleDelivery`) — a summary by
 * construction, never a message or a stack. Anything that does
 * not look like a bare class name is replaced so a future
 * free-text value can never cross this wire.
 */
export function summarizeBirthdayDeliveryError(status: unknown, errorName: unknown): string | null {
  if (status !== 'failed') return null;
  if (typeof errorName === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(errorName))
    return errorName;
  return 'UnknownError';
}
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  throw new Error('InvalidBirthdayDeliveryTimestamp');
}
/**
 * Explicit projection: only the columns the history query
 * selected, re-validated field by field. The deliveries table
 * has no birth-year or age columns, and this projection keeps
 * it that way even if the query ever grows — a row carrying
 * extra keys is a bug, not data to forward.
 */
export function projectBirthdayDeliveryHistoryRow(row: {
  date: unknown;
  discordUserId: unknown;
  kind: unknown;
  status: unknown;
  errorName: unknown;
  completedAt: unknown;
  createdAt: unknown;
}): BirthdayDeliveryHistoryItem {
  if (!date(row.date)) throw new Error('InvalidBirthdayDeliveryDate');
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidBirthdayDeliveryUser');
  if (
    typeof row.status !== 'string' ||
    !(DELIVERY_STATUSES as readonly string[]).includes(row.status)
  )
    throw new Error('InvalidBirthdayDeliveryStatus');
  const createdAt = timestamp(row.createdAt);
  if (!createdAt) throw new Error('InvalidBirthdayDeliveryTimestamp');
  return {
    date: row.date,
    discordUserId: row.discordUserId,
    category: categorizeBirthdayDeliveryKind(row.kind),
    status: row.status,
    errorSummary: summarizeBirthdayDeliveryError(row.status, row.errorName),
    completedAt: timestamp(row.completedAt),
    createdAt,
  };
}
export async function authorizeBirthdayDeliveryHistoryRead(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<BirthdayDeliveryHistoryInput | Response> {
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const secret = environment.IVRM_INTEGRATION_TOKEN,
    guild = environment.IVRM_INTEGRATION_GUILD_ID;
  if (!secret || secret.length < 32 || !guild || !/^\d{17,20}$/.test(guild))
    return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== BIRTHDAY_DELIVERY_HISTORY_PATH ||
    new URL(request.url).search
  )
    return fail(422, 'invalid_request');
  const timestamp = request.headers.get('X-IVRM-Timestamp') ?? '',
    event = request.headers.get('X-IVRM-Event-Id') ?? '',
    signature = request.headers.get('X-IVRM-Signature') ?? '';
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Math.abs(now - Date.parse(timestamp)) > 300000 ||
    !/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(event) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return fail(401, 'invalid_service_auth');
  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(request, 8192);
  } catch {
    return fail(413, 'body_too_large');
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(422, 'invalid_request');
  }
  const key = createHmac('sha256', secret).update(BIRTHDAY_DELIVERY_HISTORY_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event}.POST.${BIRTHDAY_DELIVERY_HISTORY_PATH}.${body}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    return fail(401, 'invalid_service_auth');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body);
  } catch {
    return fail(422, 'invalid_request');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !==
      ['guildId', 'from', 'to', 'limit', 'offset'].sort().join() ||
    value.guildId !== guild ||
    !date(value.from) ||
    !date(value.to) ||
    value.from > value.to ||
    !Number.isSafeInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > 100 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    Number(value.offset) > 100000
  )
    return fail(422, 'invalid_request');
  return value as unknown as BirthdayDeliveryHistoryInput;
}
