import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRequestBodyBytes } from './bounded-request-body.ts';

export const FORTUNE_ADMIN_LIST_PATH = '/api/ivrm/daily-fortunes/admin-list';
export const FORTUNE_ADMIN_LIST_PURPOSE = 'herta-daily-fortunes-admin-list-v1';

export type FortuneAdminListInput = {
  guildId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  discordUserIds?: string[];
};

const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * Backend-only Web Admin list permission. Unlike member history reads,
 * this endpoint may enumerate members after the Web API has enforced RBAC.
 * HMAC domain separation prevents swapping a member-history signature.
 */
export async function authorizeFortuneAdminList(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<FortuneAdminListInput | Response> {
  const secret = environment.IVRM_INTEGRATION_TOKEN;
  const guildId = environment.IVRM_INTEGRATION_GUILD_ID;
  if (
    environment.DAILY_BONUS_ENABLED !== 'true' ||
    !secret ||
    secret.length < 32 ||
    !guildId ||
    !/^\d{17,20}$/.test(guildId)
  )
    return fail(503, 'unconfigured');

  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== FORTUNE_ADMIN_LIST_PATH || url.search)
    return fail(422, 'invalid_request');

  const timestamp = request.headers.get('X-IVRM-Timestamp') ?? '';
  const event = request.headers.get('X-IVRM-Event-Id') ?? '';
  const signature = request.headers.get('X-IVRM-Signature') ?? '';
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Math.abs(now - Date.parse(timestamp)) > 300000 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(event) ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return fail(401, 'invalid_service_auth');

  let body: string;
  try {
    const raw = await readRequestBodyBytes(request, 8192);
    body = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return fail(413, 'body_too_large');
  }

  const key = createHmac('sha256', secret).update(FORTUNE_ADMIN_LIST_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(timestamp + '.' + event + '.POST.' + FORTUNE_ADMIN_LIST_PATH + '.' + body)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    return fail(401, 'invalid_service_auth');

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body);
  } catch {
    return fail(422, 'invalid_request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(422, 'invalid_request');

  const fields = Object.keys(value).sort().join();
  const required = ['from', 'guildId', 'limit', 'offset', 'to'].sort().join();
  const withIds = ['discordUserIds', 'from', 'guildId', 'limit', 'offset', 'to'].sort().join();
  if (
    (fields !== required && fields !== withIds) ||
    value.guildId !== guildId ||
    !validDate(value.from) ||
    !validDate(value.to) ||
    value.from > value.to ||
    Date.parse(value.to + 'T00:00:00Z') - Date.parse(value.from + 'T00:00:00Z') > 180 * 86400000 ||
    !Number.isSafeInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > 100 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    Number(value.offset) > 10000
  )
    return fail(422, 'invalid_request');

  if ('discordUserIds' in value) {
    const ids = value.discordUserIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== 'string' || !/^\d{17,20}$/.test(id)) ||
      new Set(ids).size !== ids.length
    )
      return fail(422, 'invalid_request');
  }
  return value as FortuneAdminListInput;
}
