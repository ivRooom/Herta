import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRequestBodyBytes } from './bounded-request-body.ts';
export const COMMUNITY_GAME_STATS_PATH = '/api/ivrm/community-game-stats/read';
export const COMMUNITY_GAME_STATS_PURPOSE = 'herta-community-game-stats-read-v1';
/**
 * The games list is the guild-wide breakdown Studio already
 * renders: the top 25 by total seconds (the cap of
 * getCommunityGameBreakdown in @herta/db). Only the user
 * ranking paginates, via limit/offset.
 */
export const COMMUNITY_GAME_STATS_GAMES_LIMIT = 25;
export type CommunityGameStatsMode = 'overview' | 'user';
/**
 * Contract version negotiated by the signed request body:
 * 1 (or absent) returns exactly the v1 response; 2 adds the
 * `activity` section built from community_activity_daily.
 * Signing is unchanged across versions (the v1 purpose string
 * stays the key-derivation domain separator).
 */
export type CommunityGameStatsVersion = 1 | 2;
export interface CommunityGameStatsInput {
  guildId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  mode: CommunityGameStatsMode;
  discordUserId: string | null;
  version: CommunityGameStatsVersion;
}
export interface CommunityGameStatItem {
  name: string;
  totalSeconds: number;
  playerCount: number;
}
export interface CommunityGameRankingItem {
  discordUserId: string;
  totalSeconds: number;
  topGameName: string;
}
export interface CommunityUserGameItem {
  name: string;
  totalSeconds: number;
}
/**
 * Activity metrics supplied by the v2 `activity` section, read
 * from community_activity_daily (metric / value rows). Only
 * these three metrics are part of the contract: reactions are
 * accumulated too sparsely to rank by, and no other metric may
 * leak into the response. `messages` counts only the messages
 * the Activity Rules counted (cooldown-filtered), never the
 * guild's raw message total; `voice_seconds` is stay time in
 * countable voice channels; `online_seconds` is a reference
 * total (presence time inflates while merely online).
 */
export const COMMUNITY_ACTIVITY_METRICS = ['voice_seconds', 'messages', 'online_seconds'] as const;
export type CommunityActivityMetric = (typeof COMMUNITY_ACTIVITY_METRICS)[number];
export interface CommunityActivityTotals {
  voiceSeconds: number;
  messageCount: number;
  onlineSeconds: number;
  voiceMemberCount: number;
  messageMemberCount: number;
}
export interface CommunityActivityVoiceRankingItem {
  discordUserId: string;
  totalSeconds: number;
}
export interface CommunityActivityMessageRankingItem {
  discordUserId: string;
  totalCount: number;
}
export interface CommunityActivityUserTotals {
  voiceSeconds: number;
  messageCount: number;
  onlineSeconds: number;
}
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/**
 * SUM over the BigInt `value` column crosses the wire as a
 * bigint (or a numeric string, depending on the driver path).
 * Only exact, non-negative, safe integers are accepted; a
 * fractional or overflowing aggregate is a bug, not data to
 * forward.
 */
export function toCommunityGameSeconds(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('InvalidCommunityGameSeconds');
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error('InvalidCommunityGameSeconds');
}
function gameName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128)
    throw new Error('InvalidCommunityGameName');
  return value;
}
/**
 * Explicit projections: only the columns the stats queries
 * selected, re-validated field by field. The daily table holds
 * no play content (no Rich Presence details/state), and these
 * projections keep it that way even if a query ever grows — a
 * row carrying extra keys is a bug, not data to forward.
 */
export function projectCommunityGameStatRow(row: {
  name: unknown;
  totalSeconds: unknown;
  playerCount: unknown;
}): CommunityGameStatItem {
  if (
    typeof row.playerCount !== 'number' ||
    !Number.isSafeInteger(row.playerCount) ||
    row.playerCount < 0
  )
    throw new Error('InvalidCommunityGamePlayerCount');
  return {
    name: gameName(row.name),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
    playerCount: row.playerCount,
  };
}
export function projectCommunityGameRankingRow(row: {
  discordUserId: unknown;
  totalSeconds: unknown;
  topGameName: unknown;
}): CommunityGameRankingItem {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return {
    discordUserId: row.discordUserId,
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
    topGameName: gameName(row.topGameName),
  };
}
export function projectCommunityUserGameRow(row: {
  name: unknown;
  totalSeconds: unknown;
}): CommunityUserGameItem {
  return {
    name: gameName(row.name),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
function activityUserId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value))
    throw new Error('InvalidCommunityActivityUser');
  return value;
}
function activityMemberCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('InvalidCommunityActivityMemberCount');
  return value;
}
/**
 * Activity projections follow the game-side rule: only the
 * selected columns, re-validated field by field. Aggregates
 * cross the wire through toCommunityGameSeconds, so a Decimal
 * leaking from an uncast SUM(value) throws here instead of
 * being forwarded (#1004).
 */
export function projectCommunityActivityVoiceRankingRow(row: {
  discordUserId: unknown;
  totalSeconds: unknown;
}): CommunityActivityVoiceRankingItem {
  return {
    discordUserId: activityUserId(row.discordUserId),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
export function projectCommunityActivityMessageRankingRow(row: {
  discordUserId: unknown;
  totalCount: unknown;
}): CommunityActivityMessageRankingItem {
  return {
    discordUserId: activityUserId(row.discordUserId),
    totalCount: toCommunityGameSeconds(row.totalCount),
  };
}
function activityMetricTotals(
  rows: Array<{ metric: unknown; total: unknown }>,
): Record<CommunityActivityMetric, number> {
  const totals: Record<CommunityActivityMetric, number> = {
    voice_seconds: 0,
    messages: 0,
    online_seconds: 0,
  };
  const seen = new Set<CommunityActivityMetric>();
  for (const row of rows) {
    if (
      typeof row.metric !== 'string' ||
      !(COMMUNITY_ACTIVITY_METRICS as readonly string[]).includes(row.metric)
    )
      throw new Error('InvalidCommunityActivityMetric');
    const metric = row.metric as CommunityActivityMetric;
    if (seen.has(metric)) throw new Error('InvalidCommunityActivityMetric');
    seen.add(metric);
    totals[metric] = toCommunityGameSeconds(row.total);
  }
  return totals;
}
export function projectCommunityActivityTotals(
  rows: Array<{ metric: unknown; total: unknown; memberCount: unknown }>,
): CommunityActivityTotals {
  const totals = activityMetricTotals(rows);
  const memberCounts: Record<CommunityActivityMetric, number> = {
    voice_seconds: 0,
    messages: 0,
    online_seconds: 0,
  };
  for (const row of rows)
    memberCounts[row.metric as CommunityActivityMetric] = activityMemberCount(row.memberCount);
  return {
    voiceSeconds: totals.voice_seconds,
    messageCount: totals.messages,
    onlineSeconds: totals.online_seconds,
    voiceMemberCount: memberCounts.voice_seconds,
    messageMemberCount: memberCounts.messages,
  };
}
export function projectCommunityActivityUserTotals(
  rows: Array<{ metric: unknown; total: unknown }>,
): CommunityActivityUserTotals {
  const totals = activityMetricTotals(rows);
  return {
    voiceSeconds: totals.voice_seconds,
    messageCount: totals.messages,
    onlineSeconds: totals.online_seconds,
  };
}
/**
 * MIN(activity_date) of the guild: the day observation
 * started. The column is a DATE, so the driver hands back a
 * Date at UTC midnight (or an ISO date string); anything else
 * is rejected rather than reformatted blindly.
 */
export function formatCommunityGameEarliestDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const formatted = value.toISOString().slice(0, 10);
    if (date(formatted)) return formatted;
    throw new Error('InvalidCommunityGameEarliestDate');
  }
  if (date(value)) return value;
  throw new Error('InvalidCommunityGameEarliestDate');
}
export async function authorizeCommunityGameStatsRead(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<CommunityGameStatsInput | Response> {
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const secret = environment.IVRM_INTEGRATION_TOKEN,
    guild = environment.IVRM_INTEGRATION_GUILD_ID;
  if (!secret || secret.length < 32 || !guild || !/^\d{17,20}$/.test(guild))
    return fail(503, 'unconfigured');
  if (
    request.method !== 'POST' ||
    new URL(request.url).pathname !== COMMUNITY_GAME_STATS_PATH ||
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
  const key = createHmac('sha256', secret).update(COMMUNITY_GAME_STATS_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(`${timestamp}.${event}.POST.${COMMUNITY_GAME_STATS_PATH}.${body}`)
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
  const keys = Object.keys(value).sort();
  const allowed = ['discordUserId', 'from', 'guildId', 'limit', 'mode', 'offset', 'to', 'version'];
  if (
    keys.some((key) => !allowed.includes(key)) ||
    !['from', 'guildId', 'limit', 'offset', 'to'].every((key) => keys.includes(key))
  )
    return fail(422, 'invalid_request');
  const version = value.version === undefined ? 1 : value.version;
  if (version !== 1 && version !== 2) return fail(422, 'invalid_request');
  const mode = value.mode === undefined ? 'overview' : value.mode;
  if (mode !== 'overview' && mode !== 'user') return fail(422, 'invalid_request');
  const discordUserId = value.discordUserId === undefined ? null : value.discordUserId;
  if (mode === 'overview' && discordUserId !== null) return fail(422, 'invalid_request');
  if (mode === 'user' && (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId)))
    return fail(422, 'invalid_request');
  if (
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
  return {
    guildId: value.guildId as string,
    from: value.from as string,
    to: value.to as string,
    limit: value.limit as number,
    offset: value.offset as number,
    mode,
    discordUserId: discordUserId as string | null,
    version: version as CommunityGameStatsVersion,
  };
}
