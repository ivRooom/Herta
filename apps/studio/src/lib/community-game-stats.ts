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
export type CommunityGameStatsMode = 'overview' | 'user' | 'game';
/**
 * Contract version negotiated by the signed request body:
 * 1 (or absent) returns exactly the v1 response; 2 adds the
 * `activity` section built from community_activity_daily;
 * 3 adds the `insights` sections and the `game` mode, all
 * built from community_game_activity_daily; 4 adds the
 * overview `channels` section (per-channel breakdowns from
 * community_activity_channel_daily plus the
 * message_char_units view) and `messageCharUnits` on the
 * user activity. Signing is unchanged across versions (the
 * v1 purpose string stays the key-derivation domain
 * separator).
 */
export type CommunityGameStatsVersion = 1 | 2 | 3 | 4;
export interface CommunityGameStatsInput {
  guildId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  mode: CommunityGameStatsMode;
  discordUserId: string | null;
  gameName: string | null;
  version: CommunityGameStatsVersion;
}
/**
 * The v3 overview matrix covers the period's top 15 games
 * (V2: the long tail of one-player games is served by the
 * game mode instead), and momentum looks at the trailing
 * 7 days of the requested range.
 */
export const COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT = 15;
export const COMMUNITY_GAME_STATS_MOMENTUM_WINDOW_DAYS = 7;
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
 * v4 channels shapes (S6, #1054). The per-channel breakdowns
 * come from community_activity_channel_daily, which only
 * holds rows for channels where activity actually happened
 * and only since the guild's channel recording started
 * (recordedFrom) — so channel totals never add up to the
 * activity totals, which reach further back. The lists are
 * capped like the games list (and like
 * getCommunityChannelBreakdown in @herta/db): the guild has
 * a handful of active channels, so 25 is headroom, not a
 * paging surface.
 *
 * `message_char_units` is the bot's character-points metric:
 * one unit per half-width (ASCII) character and two per
 * full-width character, excluding URLs, emoji and
 * whitespace; points are units / 2. The wire carries raw
 * integer units only — the points conversion is a display
 * concern, exactly like seconds.
 */
export const COMMUNITY_CHANNEL_BREAKDOWN_LIMIT = 25;
export interface CommunityChannelVoiceItem {
  channelId: string;
  name: string | null;
  totalSeconds: number;
  memberCount: number;
}
export interface CommunityChannelMessageItem {
  channelId: string;
  name: string | null;
  totalCount: number;
  memberCount: number;
}
export interface CommunityCharUnitsRankingItem {
  discordUserId: string;
  totalUnits: number;
}
export interface CommunityCharUnits {
  totalUnits: number;
  memberCount: number;
  ranking: {
    items: CommunityCharUnitsRankingItem[];
    pagination: { limit: number; offset: number; total: number; hasNext: boolean };
  };
}
export interface CommunityChannelsOverview {
  recordedFrom: string | null;
  voiceChannels: CommunityChannelVoiceItem[];
  messageChannels: CommunityChannelMessageItem[];
  charUnits: CommunityCharUnits;
}
export interface CommunityActivityUserTotalsV4 extends CommunityActivityUserTotals {
  messageCharUnits: number;
}
function channelId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value))
    throw new Error('InvalidCommunityChannelId');
  return value;
}
function channelMemberCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('InvalidCommunityChannelMemberCount');
  return value;
}
/**
 * Channel projections follow the same rule as the game and
 * activity ones: only the selected columns, re-validated
 * field by field, aggregates through toCommunityGameSeconds
 * so an uncast SUM throws here (#1004). The name is NOT part
 * of the SQL projection — channel names live only in
 * Discord, are resolved separately by the route, and attach
 * through projectCommunityChannelName.
 */
export function projectCommunityChannelVoiceRow(row: {
  channelId: unknown;
  totalSeconds: unknown;
  memberCount: unknown;
}): Omit<CommunityChannelVoiceItem, 'name'> {
  return {
    channelId: channelId(row.channelId),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
    memberCount: channelMemberCount(row.memberCount),
  };
}
export function projectCommunityChannelMessageRow(row: {
  channelId: unknown;
  totalCount: unknown;
  memberCount: unknown;
}): Omit<CommunityChannelMessageItem, 'name'> {
  return {
    channelId: channelId(row.channelId),
    totalCount: toCommunityGameSeconds(row.totalCount),
    memberCount: channelMemberCount(row.memberCount),
  };
}
/**
 * A resolved channel name, attached after the guild-options
 * lookup. Anything that is not a plausible current name
 * (missing channel, empty or over-long value) degrades to
 * null instead of failing the section: the display falls
 * back to an id-derived label, and a name is never invented.
 */
export function projectCommunityChannelName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 100) return null;
  return trimmed;
}
export function projectCommunityCharUnitsRankingRow(row: {
  discordUserId: unknown;
  totalUnits: unknown;
}): CommunityCharUnitsRankingItem {
  return {
    discordUserId: activityUserId(row.discordUserId),
    totalUnits: toCommunityGameSeconds(row.totalUnits),
  };
}
export function projectCommunityCharUnitsTotalsRow(row: {
  totalUnits: unknown;
  memberCount: unknown;
}): { totalUnits: number; memberCount: number } {
  return {
    totalUnits: toCommunityGameSeconds(row.totalUnits),
    memberCount: channelMemberCount(row.memberCount),
  };
}
const COMMUNITY_ACTIVITY_USER_METRICS_V4 = [
  ...COMMUNITY_ACTIVITY_METRICS,
  'message_char_units',
] as const;
/**
 * The v4 user activity adds message_char_units to the three
 * v2 metrics. It is a separate projection (not a widened
 * v2 one) so the v2/v3 shape stays pinned: a char-units row
 * in a v2 read, or an unknown metric in a v4 read, throws.
 */
export function projectCommunityActivityUserTotalsV4(
  rows: Array<{ metric: unknown; total: unknown }>,
): CommunityActivityUserTotalsV4 {
  const totals: Record<(typeof COMMUNITY_ACTIVITY_USER_METRICS_V4)[number], number> = {
    voice_seconds: 0,
    messages: 0,
    online_seconds: 0,
    message_char_units: 0,
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.metric !== 'string' ||
      !(COMMUNITY_ACTIVITY_USER_METRICS_V4 as readonly string[]).includes(row.metric)
    )
      throw new Error('InvalidCommunityActivityMetric');
    const metric = row.metric as (typeof COMMUNITY_ACTIVITY_USER_METRICS_V4)[number];
    if (seen.has(metric)) throw new Error('InvalidCommunityActivityMetric');
    seen.add(metric);
    totals[metric] = toCommunityGameSeconds(row.total);
  }
  return {
    voiceSeconds: totals.voice_seconds,
    messageCount: totals.messages,
    onlineSeconds: totals.online_seconds,
    messageCharUnits: totals.message_char_units,
  };
}
/**
 * v3 insights shapes (S5, #1041), all aggregated from
 * community_game_activity_daily. Weekday arrays are Monday
 * first (ISO day of week 1..7 mapped to indexes 0..6).
 */
export interface CommunityInsightsOverviewTotals {
  totalSeconds: number;
  playerCount: number;
}
export interface CommunityMatrixMember {
  discordUserId: string;
  secondsByGame: number[];
}
export interface CommunityGameMomentumItem {
  name: string;
  recentSeconds: number;
  newPlayerCount: number;
}
export interface CommunityInsightsOverview {
  totals: CommunityInsightsOverviewTotals;
  matrix: { games: string[]; members: CommunityMatrixMember[] };
  weekdaySeconds: number[];
  momentum: CommunityGameMomentumItem[];
}
export interface CommunityGameDailyPoint {
  date: string;
  totalSeconds: number;
}
export interface CommunityInsightsUser {
  playDays: number;
  longestStreakDays: number;
  currentStreakDays: number;
  lastPlayDate: string | null;
  dailySeries: CommunityGameDailyPoint[];
  weekdaySeconds: number[];
}
export interface CommunityGameDetail {
  name: string;
  totalSeconds: number;
  playerCount: number;
  firstPlayDate: string | null;
  lastPlayDate: string | null;
}
export interface CommunityGamePlayerItem {
  discordUserId: string;
  totalSeconds: number;
}
export interface CommunityGameViewer {
  discordUserId: string;
  rank: number | null;
  totalSeconds: number;
}
/**
 * A DATE column crosses the wire as a Date at UTC midnight
 * (or an ISO date string); the earliest-date formatter
 * already validates both, and a daily row may never carry a
 * null date.
 */
export function toCommunityGameDateString(value: unknown): string {
  const formatted = formatCommunityGameEarliestDate(value);
  if (formatted === null) throw new Error('InvalidCommunityGameDate');
  return formatted;
}
export function projectCommunityInsightsTotalsRow(row: {
  totalSeconds: unknown;
  playerCount: unknown;
}): CommunityInsightsOverviewTotals {
  if (
    typeof row.playerCount !== 'number' ||
    !Number.isSafeInteger(row.playerCount) ||
    row.playerCount < 0
  )
    throw new Error('InvalidCommunityGamePlayerCount');
  return {
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
    playerCount: row.playerCount,
  };
}
export function projectCommunityTopGameRow(row: { name: unknown }): string {
  return gameName(row.name);
}
export function projectCommunityMatrixMemberRow(row: { discordUserId: unknown }): {
  discordUserId: string;
} {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return { discordUserId: row.discordUserId };
}
export function projectCommunityMatrixCellRow(row: {
  discordUserId: unknown;
  name: unknown;
  totalSeconds: unknown;
}): CommunityMatrixCell {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return {
    discordUserId: row.discordUserId,
    name: gameName(row.name),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
export interface CommunityMatrixCell {
  discordUserId: string;
  name: string;
  totalSeconds: number;
}
/**
 * Assembles the matrix body: one row per member (in the
 * order the member query returned, period total descending),
 * with seconds aligned to the games array and zero where the
 * member never played that game in the period. Cells for
 * games outside the list or members outside the list are a
 * query bug and are dropped rather than widening the shape.
 */
export function buildCommunityMatrix(
  games: string[],
  members: Array<{ discordUserId: string }>,
  cells: CommunityMatrixCell[],
): CommunityMatrixMember[] {
  const gameIndex = new Map(games.map((name, index) => [name, index]));
  const byMember = new Map<string, number[]>(
    members.map((member) => [member.discordUserId, new Array<number>(games.length).fill(0)]),
  );
  for (const cell of cells) {
    const row = byMember.get(cell.discordUserId);
    const index = gameIndex.get(cell.name);
    if (row && index !== undefined) row[index] = cell.totalSeconds;
  }
  return members.map((member) => ({
    discordUserId: member.discordUserId,
    secondsByGame: byMember.get(member.discordUserId) ?? new Array<number>(games.length).fill(0),
  }));
}
export function projectCommunityWeekdaySecondsRow(row: {
  isoDow: unknown;
  totalSeconds: unknown;
}): { isoDow: number; totalSeconds: number } {
  if (
    typeof row.isoDow !== 'number' ||
    !Number.isSafeInteger(row.isoDow) ||
    row.isoDow < 1 ||
    row.isoDow > 7
  )
    throw new Error('InvalidCommunityWeekday');
  return { isoDow: row.isoDow, totalSeconds: toCommunityGameSeconds(row.totalSeconds) };
}
/**
 * Zero-fills the Monday-first weekday array from the grouped
 * rows; a duplicated weekday is a query bug, not data.
 */
export function buildCommunityWeekdaySeconds(
  rows: Array<{ isoDow: number; totalSeconds: number }>,
): number[] {
  const seconds = [0, 0, 0, 0, 0, 0, 0];
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.isoDow)) throw new Error('InvalidCommunityWeekday');
    seen.add(row.isoDow);
    seconds[row.isoDow - 1] = row.totalSeconds;
  }
  return seconds;
}
export function projectCommunityMomentumRecentRow(row: { name: unknown; recentSeconds: unknown }): {
  name: string;
  recentSeconds: number;
} {
  return { name: gameName(row.name), recentSeconds: toCommunityGameSeconds(row.recentSeconds) };
}
export function projectCommunityMomentumNewPlayersRow(row: {
  name: unknown;
  newPlayerCount: unknown;
}): { name: string; newPlayerCount: number } {
  if (
    typeof row.newPlayerCount !== 'number' ||
    !Number.isSafeInteger(row.newPlayerCount) ||
    row.newPlayerCount < 0
  )
    throw new Error('InvalidCommunityGamePlayerCount');
  return { name: gameName(row.name), newPlayerCount: row.newPlayerCount };
}
/**
 * Merges the two momentum queries in top-games order; a game
 * missing from either result zero-fills instead of dropping
 * out of the list.
 */
export function buildCommunityMomentum(
  games: string[],
  recent: Array<{ name: string; recentSeconds: number }>,
  fresh: Array<{ name: string; newPlayerCount: number }>,
): CommunityGameMomentumItem[] {
  const recentByName = new Map(recent.map((row) => [row.name, row.recentSeconds]));
  const freshByName = new Map(fresh.map((row) => [row.name, row.newPlayerCount]));
  return games.map((name) => ({
    name,
    recentSeconds: recentByName.get(name) ?? 0,
    newPlayerCount: freshByName.get(name) ?? 0,
  }));
}
export function projectCommunityGameDailyPointRow(row: {
  date: unknown;
  totalSeconds: unknown;
}): CommunityGameDailyPoint {
  return {
    date: toCommunityGameDateString(row.date),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
/**
 * Streaks over the user's observed play dates (the full
 * history up to the range end, per the S5 design): the
 * longest run of consecutive days, and the run that ends on
 * the most recent play date. Observation gaps break a streak
 * exactly like a day without play does — the board only ever
 * claims what Discord presence observed.
 */
export function summarizeCommunityPlayDates(dates: string[]): {
  longestStreakDays: number;
  currentStreakDays: number;
  lastPlayDate: string | null;
} {
  const unique = [...new Set(dates)].sort();
  for (const day of unique) if (!date(day)) throw new Error('InvalidCommunityGameDate');
  if (unique.length === 0)
    return { longestStreakDays: 0, currentStreakDays: 0, lastPlayDate: null };
  let longest = 1;
  let run = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const previous = Date.parse(`${unique[index - 1]}T00:00:00Z`);
    const current = Date.parse(`${unique[index]}T00:00:00Z`);
    run = current - previous === 86_400_000 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return {
    longestStreakDays: longest,
    currentStreakDays: run,
    lastPlayDate: unique[unique.length - 1] as string,
  };
}
export function projectCommunityGameDetailRow(row: {
  name: unknown;
  totalSeconds: unknown;
  playerCount: unknown;
  firstPlayDate: unknown;
  lastPlayDate: unknown;
}): CommunityGameDetail {
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
    firstPlayDate: formatCommunityGameEarliestDate(row.firstPlayDate),
    lastPlayDate: formatCommunityGameEarliestDate(row.lastPlayDate),
  };
}
export function projectCommunityGamePlayerRow(row: {
  discordUserId: unknown;
  totalSeconds: unknown;
}): CommunityGamePlayerItem {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return {
    discordUserId: row.discordUserId,
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
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
  const allowed = [
    'discordUserId',
    'from',
    'gameName',
    'guildId',
    'limit',
    'mode',
    'offset',
    'to',
    'version',
  ];
  if (
    keys.some((key) => !allowed.includes(key)) ||
    !['from', 'guildId', 'limit', 'offset', 'to'].every((key) => keys.includes(key))
  )
    return fail(422, 'invalid_request');
  const version = value.version === undefined ? 1 : value.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4)
    return fail(422, 'invalid_request');
  const mode = value.mode === undefined ? 'overview' : value.mode;
  if (mode !== 'overview' && mode !== 'user' && mode !== 'game')
    return fail(422, 'invalid_request');
  const discordUserId = value.discordUserId === undefined ? null : value.discordUserId;
  if (mode === 'overview' && discordUserId !== null) return fail(422, 'invalid_request');
  if (mode === 'user' && (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId)))
    return fail(422, 'invalid_request');
  const gameName = value.gameName === undefined ? null : value.gameName;
  if (mode === 'game') {
    // The game mode exists only in contract v3 and later
    // (its shape is unchanged in v4), names the one game to
    // detail, and takes discordUserId as an optional viewer
    // whose rank is reported alongside the players.
    if (version !== 3 && version !== 4) return fail(422, 'invalid_request');
    if (
      typeof gameName !== 'string' ||
      gameName.trim() === '' ||
      gameName.length > 128 ||
      (discordUserId !== null &&
        (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId)))
    )
      return fail(422, 'invalid_request');
  } else if (gameName !== null) return fail(422, 'invalid_request');
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
    gameName: gameName as string | null,
    version: version as CommunityGameStatsVersion,
  };
}
