import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';
import { readRequestBodyBytes } from './bounded-request-body.ts';

export const BIRTHDAY_MANUAL_DELIVERY_PATH = '/api/ivrm/birthday-deliveries/manual';
export const BIRTHDAY_MANUAL_DELIVERY_PURPOSE = 'herta-birthday-manual-delivery-v1';

export interface BirthdayManualDeliveryInput {
  guildId: string;
  discordUserId: string;
  localDate: string;
}

/**
 * The result contract shared bot → Studio → ivrm-web (#1062).
 * `rejected` means the run never started and `reason` carries
 * one of the fixed pre-check codes; per-kind failures inside an
 * `ok` result carry either a fixed code or a bare error-class
 * summary (the same discipline as the deliveries-read wire:
 * raw messages, birth years, ages and raw delivery kinds never
 * cross this boundary, and anything unexpected fails closed).
 */
export const BIRTHDAY_MANUAL_DELIVERY_REJECTION_REASONS = [
  'plugin_not_enabled',
  'ivrm_source_disabled',
  'date_out_of_range',
  'supply_unavailable',
  'delivery_disabled',
  'not_a_recipient',
] as const;
export type BirthdayManualDeliveryRejectionReason =
  (typeof BIRTHDAY_MANUAL_DELIVERY_REJECTION_REASONS)[number];

export const BIRTHDAY_MANUAL_DELIVERY_FAILURE_REASONS = [
  'member_not_in_guild',
  'role_not_editable',
  'channel_unavailable',
] as const;
export type BirthdayManualDeliveryFailureReason =
  (typeof BIRTHDAY_MANUAL_DELIVERY_FAILURE_REASONS)[number];

export type BirthdayManualDeliveryCategory = 'card' | 'role_assign';
export type BirthdayManualDeliveryOutcome =
  'delivered' | 'already_delivered' | 'failed' | 'not_configured' | 'in_progress';

export interface BirthdayManualDeliveryKindResult {
  category: BirthdayManualDeliveryCategory;
  outcome: BirthdayManualDeliveryOutcome;
  reason: string | null;
}

export interface BirthdayManualDeliveryResult {
  status: 'ok' | 'rejected';
  reason: string | null;
  deliveries: BirthdayManualDeliveryKindResult[];
}

const DELIVERY_CATEGORIES: readonly string[] = ['card', 'role_assign'];
const DELIVERY_OUTCOMES: readonly string[] = [
  'delivered',
  'already_delivered',
  'failed',
  'not_configured',
  'in_progress',
];
const ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

function isKindFailureReason(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ((BIRTHDAY_MANUAL_DELIVERY_FAILURE_REASONS as readonly string[]).includes(value) ||
      ERROR_NAME_PATTERN.test(value))
  );
}

/**
 * Strict validation of the bot's result before it is relayed.
 * Unknown keys, unknown reason codes or an inconsistent shape
 * return null so the caller can fail closed as `unavailable`
 * instead of forwarding data the contract never promised.
 */
export function parseBirthdayManualDeliveryResult(
  value: unknown,
): BirthdayManualDeliveryResult | null {
  if (!isRecord(value) || !hasExactlyKeys(value, ['status', 'reason', 'deliveries'])) return null;
  if (value.status !== 'ok' && value.status !== 'rejected') return null;
  if (!Array.isArray(value.deliveries)) return null;

  if (value.status === 'rejected') {
    if (
      typeof value.reason !== 'string' ||
      !(BIRTHDAY_MANUAL_DELIVERY_REJECTION_REASONS as readonly string[]).includes(value.reason) ||
      value.deliveries.length !== 0
    ) {
      return null;
    }
    return { status: 'rejected', reason: value.reason, deliveries: [] };
  }

  if (value.reason !== null) return null;
  if (value.deliveries.length > DELIVERY_CATEGORIES.length) return null;
  const seen = new Set<string>();
  const deliveries: BirthdayManualDeliveryKindResult[] = [];
  for (const entry of value.deliveries) {
    if (!isRecord(entry) || !hasExactlyKeys(entry, ['category', 'outcome', 'reason'])) return null;
    if (
      typeof entry.category !== 'string' ||
      !DELIVERY_CATEGORIES.includes(entry.category) ||
      seen.has(entry.category)
    ) {
      return null;
    }
    seen.add(entry.category);
    if (typeof entry.outcome !== 'string' || !DELIVERY_OUTCOMES.includes(entry.outcome)) {
      return null;
    }
    if (entry.outcome === 'failed') {
      if (!isKindFailureReason(entry.reason)) return null;
    } else if (entry.reason !== null) {
      return null;
    }
    deliveries.push({
      category: entry.category as BirthdayManualDeliveryCategory,
      outcome: entry.outcome as BirthdayManualDeliveryOutcome,
      reason: entry.reason as string | null,
    });
  }
  return { status: 'ok', reason: null, deliveries };
}

const localDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * Same HMAC service-auth shape as the deliveries-read window
 * (purpose-derived key, five-minute freshness, exact body key
 * set, Guild bound to the configured integration guild), with
 * its own purpose so a read signature can never be replayed as
 * a delivery trigger.
 */
export async function authorizeBirthdayManualDelivery(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<BirthdayManualDeliveryInput | Response> {
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const secret = environment.IVRM_INTEGRATION_TOKEN,
    guild = environment.IVRM_INTEGRATION_GUILD_ID;
  if (!secret || secret.length < 32 || !guild || !/^\d{17,20}$/.test(guild))
    return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== BIRTHDAY_MANUAL_DELIVERY_PATH ||
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
  const key = createHmac('sha256', secret).update(BIRTHDAY_MANUAL_DELIVERY_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event}.POST.${BIRTHDAY_MANUAL_DELIVERY_PATH}.${body}`)
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
    Object.keys(value).sort().join() !== ['guildId', 'discordUserId', 'localDate'].sort().join() ||
    value.guildId !== guild ||
    typeof value.discordUserId !== 'string' ||
    !/^\d{17,20}$/.test(value.discordUserId) ||
    !localDate(value.localDate)
  )
    return fail(422, 'invalid_request');
  return value as unknown as BirthdayManualDeliveryInput;
}

const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export class BirthdayManualDeliveryError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Birthday manual delivery request failed (${status})`);
    this.name = 'BirthdayManualDeliveryError';
    this.status = status;
  }
}

/**
 * apps/bot/src/health/server.tsの
 * `/internal/guilds/:guildId/birthday/manual-delivery`を呼び、手動配信の
 * 実行をBotプロセスへ委ねる(StudioはBotトークンを持たないため)。
 * MBTIロール再同期と同じ内部APIパターン。配信はカード生成+Discord
 * 送信を含む実行系なので、タイムアウトはhealth系より長く30秒級に取る。
 */
export async function requestBirthdayManualDelivery(
  guildId: string,
  input: { discordUserId: string; localDate: string },
  fetchImpl: typeof fetch = fetch,
): Promise<BirthdayManualDeliveryResult> {
  const url = resolveBotInternalBirthdayManualDeliveryUrl(guildId);
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!url || !secret || secret.length < MIN_INTERNAL_API_SECRET_LENGTH) {
    throw new BirthdayManualDeliveryError(503);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(resolveBotHealthRequestTimeoutMs() + 10_000, 30_000)),
    });
  } catch {
    throw new BirthdayManualDeliveryError(502);
  }

  if (!response.ok) {
    if (response.status === 404) throw new BirthdayManualDeliveryError(404);
    if (response.status === 429) throw new BirthdayManualDeliveryError(429);
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      throw new BirthdayManualDeliveryError(503);
    }
    throw new BirthdayManualDeliveryError(502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BirthdayManualDeliveryError(502);
  }

  const result = isRecord(payload) ? parseBirthdayManualDeliveryResult(payload.result) : null;
  if (!result) throw new BirthdayManualDeliveryError(502);
  return result;
}

function resolveBotInternalBirthdayManualDeliveryUrl(guildId: string): string | null {
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl || !/^\d{17,20}$/u.test(guildId)) return null;

  try {
    const url = new URL(healthUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `/internal/guilds/${guildId}/birthday/manual-delivery`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
