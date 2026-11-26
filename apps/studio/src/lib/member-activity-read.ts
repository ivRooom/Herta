import { authorizeIvrmIntegrationRequest } from './ivrm-integration-auth.ts';
import { readRequestBodyBytes } from './bounded-request-body.ts';

export const MEMBER_ACTIVITY_READ_PATH = '/api/ivrm/member-activity/read';

/**
 * Read-only projection of the bot's MemberActivityEvent ledger for the
 * ivrm-web Admin audit view (#1040 H2, canonical design: Herta #539).
 * No new ledger is created; reads go through searchMemberActivityEvents
 * in @herta/db. The message body (content) is never projected: the feed
 * query does not select it and projectMemberActivityEvent re-picks the
 * wire fields explicitly, so a future feed field cannot leak across.
 *
 * Auth is the shared integration Bearer token
 * (authorizeIvrmIntegrationRequest): the guild is fixed server-side by
 * IVRM_INTEGRATION_GUILD_ID and the body's guildId is only a consistency
 * check against it, never an authorization source.
 */
export interface MemberActivityReadInput {
  guildId: string;
  from: Date | null;
  /** Upper bound for occurredAt, exclusive (maps to the feed's toExclusive). */
  toExclusive: Date | null;
  userId: string | null;
  channelId: string | null;
  /** Exact event type match. A single type is the contract; listing every
   * type is equivalent to omitting the filter. */
  event: string | null;
  page: number;
  pageSize: number;
}

export interface MemberActivityReadItem {
  id: string;
  /** Executor when the ledger resolved one (Audit Log sourced rows carry
   * the executor here); null stays null — never guessed. */
  userId: string | null;
  event: string;
  channelId: string | null;
  messageId: string | null;
  /** Structured ledger metadata as stored. Labeling/normalization for
   * display is the consumer's job (ivrm-web #1984 discord.* catalog). */
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const EVENT_TYPE_PATTERN = /^[a-z0-9_]{1,32}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const ALLOWED_KEYS = ['guildId', 'from', 'to', 'userId', 'channelId', 'event', 'page', 'pageSize'];
const MAX_BODY_BYTES = 8192;
const MAX_PAGE = 100000;

function fail(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json(
    { error },
    { status, headers: { 'Cache-Control': 'private, no-store', ...headers } },
  );
}

function parseTimestamp(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function parseSnowflake(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && SNOWFLAKE_PATTERN.test(value) ? value : undefined;
}

export async function authorizeMemberActivityRead(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
): Promise<MemberActivityReadInput | Response> {
  const authorization = authorizeIvrmIntegrationRequest(request, environment);
  if (authorization.status === 'unconfigured') return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== MEMBER_ACTIVITY_READ_PATH ||
    new URL(request.url).search
  )
    return fail(422, 'invalid_request');
  if (authorization.status === 'unauthorized')
    return fail(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
  const guildId = authorization.config.guildId;

  let bytes: Uint8Array;
  try {
    bytes = await readRequestBodyBytes(request, MAX_BODY_BYTES);
  } catch {
    return fail(413, 'body_too_large');
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(422, 'invalid_request');
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return fail(422, 'invalid_request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(422, 'invalid_request');
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.includes(key)))
    return fail(422, 'invalid_request');
  if (typeof value.guildId !== 'string') return fail(422, 'invalid_request');
  if (value.guildId !== guildId) return fail(400, 'guild_mismatch');

  const from = parseTimestamp(value.from);
  const toExclusive = parseTimestamp(value.to);
  const userId = parseSnowflake(value.userId);
  const channelId = parseSnowflake(value.channelId);
  if (from === undefined || toExclusive === undefined) return fail(422, 'invalid_request');
  if (userId === undefined || channelId === undefined) return fail(422, 'invalid_request');
  if (from && toExclusive && from.getTime() > toExclusive.getTime())
    return fail(422, 'invalid_request');

  let event: string | null = null;
  if (value.event !== undefined && value.event !== null) {
    if (typeof value.event !== 'string' || !EVENT_TYPE_PATTERN.test(value.event))
      return fail(422, 'invalid_request');
    event = value.event;
  }

  let page = 1;
  if (value.page !== undefined && value.page !== null) {
    if (
      !Number.isSafeInteger(value.page) ||
      Number(value.page) < 1 ||
      Number(value.page) > MAX_PAGE
    )
      return fail(422, 'invalid_request');
    page = Number(value.page);
  }
  let pageSize = 25;
  if (value.pageSize !== undefined && value.pageSize !== null) {
    if (!Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1)
      return fail(422, 'invalid_request');
    // Values above the feed's MAX_PAGE_SIZE (50) are clamped inside
    // searchMemberActivityEvents; the response reports the effective size.
    pageSize = Number(value.pageSize);
  }

  return { guildId, from, toExclusive, userId, channelId, event, page, pageSize };
}

/**
 * Explicit projection: only the wire fields, re-validated field by field.
 * Anything else a ledger row may carry in the future (above all the
 * message body in `content`) is dropped here, not forwarded.
 */
export function projectMemberActivityEvent(item: {
  id: unknown;
  userId: unknown;
  event: unknown;
  channelId: unknown;
  messageId: unknown;
  metadata: unknown;
  occurredAt: unknown;
}): MemberActivityReadItem {
  if (typeof item.id !== 'string' || item.id.length === 0)
    throw new Error('InvalidMemberActivityEvent');
  if (
    item.userId !== null &&
    (typeof item.userId !== 'string' || !SNOWFLAKE_PATTERN.test(item.userId))
  )
    throw new Error('InvalidMemberActivityEvent');
  if (typeof item.event !== 'string' || !EVENT_TYPE_PATTERN.test(item.event))
    throw new Error('InvalidMemberActivityEvent');
  if (
    item.channelId !== null &&
    (typeof item.channelId !== 'string' || !SNOWFLAKE_PATTERN.test(item.channelId))
  )
    throw new Error('InvalidMemberActivityEvent');
  if (
    item.messageId !== null &&
    (typeof item.messageId !== 'string' || !SNOWFLAKE_PATTERN.test(item.messageId))
  )
    throw new Error('InvalidMemberActivityEvent');
  if (item.metadata !== null && (typeof item.metadata !== 'object' || Array.isArray(item.metadata)))
    throw new Error('InvalidMemberActivityEvent');
  if (typeof item.occurredAt !== 'string' || !Number.isFinite(Date.parse(item.occurredAt)))
    throw new Error('InvalidMemberActivityEvent');
  return {
    id: item.id,
    userId: item.userId as string | null,
    event: item.event,
    channelId: item.channelId as string | null,
    messageId: item.messageId as string | null,
    metadata: item.metadata as Record<string, unknown> | null,
    occurredAt: new Date(item.occurredAt).toISOString(),
  };
}
