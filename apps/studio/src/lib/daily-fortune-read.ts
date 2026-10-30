import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRequestBodyBytes } from './bounded-request-body.ts';
export const DAILY_FORTUNE_READ_PATH = '/api/ivrm/daily-fortunes/read';
export const DAILY_FORTUNE_READ_PURPOSE = 'herta-daily-fortunes-read-v1';
export interface FortuneReadInput {
  guildId: string;
  discordUserId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
}
/** Explicit projection guards history responses against future profile-bearing result fields. */
export function publicFortuneHistoryResult(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('InvalidFortuneResult');
  const r = value as Record<string, unknown>,
    result: Record<string, unknown> = {};
  for (const field of [
    'date',
    'title',
    'hex',
    'message',
    'action',
    'color',
    'item',
    'luckyTime',
    'disclaimer',
  ]) {
    if (typeof r[field] !== 'string' || (r[field] as string).length > 4000)
      throw new Error('InvalidFortuneResult');
    result[field] = r[field];
  }
  for (const field of ['stars', 'luckyNumber']) {
    if (
      !Number.isSafeInteger(r[field]) ||
      Number(r[field]) < 1 ||
      Number(r[field]) > (field === 'stars' ? 5 : 9)
    )
      throw new Error('InvalidFortuneResult');
    result[field] = r[field];
  }
  if (!Array.isArray(r.categories) || r.categories.length > 10)
    throw new Error('InvalidFortuneResult');
  result.categories = r.categories.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('InvalidFortuneResult');
    const c = value as Record<string, unknown>;
    if (
      typeof c.name !== 'string' ||
      typeof c.advice !== 'string' ||
      c.name.length > 100 ||
      c.advice.length > 2000 ||
      !Number.isSafeInteger(c.stars) ||
      Number(c.stars) < 1 ||
      Number(c.stars) > 5
    )
      throw new Error('InvalidFortuneResult');
    return { name: c.name, stars: c.stars, advice: c.advice };
  });
  return result;
}
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export async function authorizeDailyFortuneRead(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<FortuneReadInput | Response> {
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const secret = environment.IVRM_INTEGRATION_TOKEN,
    guild = environment.IVRM_INTEGRATION_GUILD_ID;
  if (
    environment.DAILY_BONUS_ENABLED !== 'true' ||
    !secret ||
    secret.length < 32 ||
    !guild ||
    !/^\d{17,20}$/.test(guild)
  )
    return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== DAILY_FORTUNE_READ_PATH ||
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
  const key = createHmac('sha256', secret).update(DAILY_FORTUNE_READ_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event}.POST.${DAILY_FORTUNE_READ_PATH}.${body}`)
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
      ['guildId', 'discordUserId', 'from', 'to', 'limit', 'offset'].sort().join() ||
    value.guildId !== guild ||
    typeof value.discordUserId !== 'string' ||
    !/^\d{17,20}$/.test(value.discordUserId) ||
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
  return value as unknown as FortuneReadInput;
}
