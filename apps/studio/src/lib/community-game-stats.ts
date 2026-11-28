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
export type CommunityGameStatsMode = 'overview' | 'user' | 'game' | 'channel';
/**
 * Contract version negotiated by the signed request body:
 * 1 (or absent) returns exactly the v1 response; 2 adds the
 * `activity` section built from community_activity_daily;
 * 3 adds the `insights` sections and the `game` mode, all
 * built from community_game_activity_daily; 4 adds the
 * overview `channels` section (per-channel breakdowns from
 * community_activity_channel_daily plus the
 * message_char_units view) and `messageCharUnits` on the
 * user activity; 5 unifies games across localized /
 * client-specific activity names (S7): game-bearing
 * sections carry a unified `key` and `applicationId`
 * alongside the display name, and the game mode also
 * accepts `gameApplicationId` / `gameKey` selectors;
 * 6 adds the overview `leaderboards` section (S9): member
 * rankings by distinct unified games played (gameCount),
 * by distinct play days (playDays) and by absolute growth
 * against the previous period (growth), all aggregated
 * from community_game_activity_daily; 7 adds the overview
 * `weeklyChampions` section (S10): the raw per-week leader
 * candidates the relay counts weekly titles from, and the
 * `channel` mode: one channel's member ranking from
 * community_activity_channel_daily, selected by
 * `channelId` / `channelMetric` exactly like the game mode
 * selects one game. Signing is unchanged across versions
 * (the v1 purpose string stays the key-derivation domain
 * separator).
 */
export type CommunityGameStatsVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface CommunityGameStatsInput {
  guildId: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  mode: CommunityGameStatsMode;
  discordUserId: string | null;
  gameName: string | null;
  gameApplicationId: string | null;
  gameKey: string | null;
  channelId: string | null;
  channelMetric: CommunityChannelMetric | null;
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
/**
 * v5 game identity (S7b, #1060). Since S7a the daily rows
 * carry the Discord application_id next to the activity
 * name ('' when the presence had none — which covers every
 * row recorded before S7a). The same game still appears
 * under several names (localized clients, Rich Presence
 * variants), so v5 unifies rows into game groups at read
 * time:
 *
 *   1. a row whose application_id is listed in a mapping
 *      belongs to that mapping's canonical game;
 *   2. any other row with an application_id groups by id;
 *   3. a row without an id whose name is listed in a
 *      mapping (as an alias or as the canonical name
 *      itself) belongs to that canonical game — this is
 *      what unifies the pre-S7a history;
 *   4. anything else groups by its recorded name.
 *
 * A group's key is `app:<applicationId>` when the group
 * has an id (for a mapped game, the mapping's first id)
 * and `name:<activityName>` otherwise. The display name
 * is the mapping's canonical name when mapped, else the
 * name under which the group accumulated the most seconds
 * in the period (W7; ties break to the smaller name so
 * the choice is deterministic). Mappings live in the
 * guild's Activity Rules config (W3) and are applied
 * only here, on the supply side (W2); stored rows are
 * never rewritten (W5).
 */
export interface CommunityGameIdentityMapping {
  canonicalName: string;
  applicationIds: string[];
  activityNames: string[];
}
export interface CommunityGameIdentity {
  key: string;
  name: string;
  applicationId: string | null;
}
export interface CommunityGameStatItemV5 extends CommunityGameIdentity {
  totalSeconds: number;
  playerCount: number;
}
export interface CommunityGameRankingItemV5 {
  discordUserId: string;
  totalSeconds: number;
  topGameName: string;
  topGameKey: string;
}
export interface CommunityUserGameItemV5 extends CommunityGameIdentity {
  totalSeconds: number;
}
export interface CommunityGameMomentumItemV5 extends CommunityGameIdentity {
  recentSeconds: number;
  newPlayerCount: number;
}
export interface CommunityInsightsOverviewV5 {
  totals: CommunityInsightsOverviewTotals;
  matrix: { games: CommunityGameIdentity[]; members: CommunityMatrixMember[] };
  weekdaySeconds: number[];
  momentum: CommunityGameMomentumItemV5[];
}
export interface CommunityGameDetailV5 extends CommunityGameIdentity {
  totalSeconds: number;
  playerCount: number;
  firstPlayDate: string | null;
  lastPlayDate: string | null;
}
export interface CommunityGameResolution {
  key: string;
  canonicalName: string | null;
  applicationId: string | null;
}
function communityGameMappingKey(mapping: CommunityGameIdentityMapping): string {
  return mapping.applicationIds.length > 0
    ? `app:${mapping.applicationIds[0]}`
    : `name:${mapping.canonicalName}`;
}
export function findCommunityGameMappingByApplicationId(
  mappings: readonly CommunityGameIdentityMapping[],
  applicationId: string,
): CommunityGameIdentityMapping | null {
  return mappings.find((mapping) => mapping.applicationIds.includes(applicationId)) ?? null;
}
export function findCommunityGameMappingByName(
  mappings: readonly CommunityGameIdentityMapping[],
  name: string,
): CommunityGameIdentityMapping | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return (
    mappings.find(
      (mapping) =>
        mapping.canonicalName.trim().toLowerCase() === normalized ||
        mapping.activityNames.some((alias) => alias.trim().toLowerCase() === normalized),
    ) ?? null
  );
}
/**
 * Resolves one recorded (name, applicationId) pair to its
 * unified game, following the decision order documented
 * above. Name matching follows the exclusion-list rule
 * (trimmed, case-insensitive exact match).
 */
export function resolveCommunityGame(
  name: string,
  applicationId: string | null,
  mappings: readonly CommunityGameIdentityMapping[],
): CommunityGameResolution {
  if (applicationId) {
    const byId = findCommunityGameMappingByApplicationId(mappings, applicationId);
    if (byId)
      return {
        key: communityGameMappingKey(byId),
        canonicalName: byId.canonicalName,
        applicationId: byId.applicationIds[0] ?? applicationId,
      };
    return { key: `app:${applicationId}`, canonicalName: null, applicationId };
  }
  const byName = findCommunityGameMappingByName(mappings, name);
  if (byName)
    return {
      key: communityGameMappingKey(byName),
      canonicalName: byName.canonicalName,
      applicationId: byName.applicationIds[0] ?? null,
    };
  return { key: `name:${name}`, canonicalName: null, applicationId: null };
}
/**
 * A unified game key as carried on the wire: `app:` plus a
 * snowflake, or `name:` plus the recorded activity name
 * (1–128 chars, not blank). Keys are produced by
 * resolveCommunityGame; this only validates the shape of
 * a key handed back in a game-mode request.
 */
export function isCommunityGameKey(value: string): boolean {
  if (value.startsWith('app:')) return /^\d{17,20}$/.test(value.slice(4));
  if (value.startsWith('name:')) {
    const name = value.slice(5);
    return name.trim() !== '' && name.length <= 128;
  }
  return false;
}
/**
 * One (name, application_id) aggregate row of the daily
 * table. The id column is TEXT NOT NULL with '' as the
 * unknown sentinel (the PK cannot hold NULL), so '' — and
 * only '' — projects to null; any other non-snowflake
 * value is a bug, not data to forward.
 */
export interface CommunityGameSourceRow {
  name: string;
  applicationId: string | null;
  totalSeconds: number;
}
function gameApplicationId(value: unknown): string | null {
  if (typeof value !== 'string') throw new Error('InvalidCommunityGameApplicationId');
  if (value === '') return null;
  if (!/^\d+$/.test(value)) throw new Error('InvalidCommunityGameApplicationId');
  return value;
}
export function projectCommunityGameSourceRow(row: {
  name: unknown;
  applicationId: unknown;
  totalSeconds: unknown;
}): CommunityGameSourceRow {
  return {
    name: gameName(row.name),
    applicationId: gameApplicationId(row.applicationId),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
export interface CommunityGameUserSourceRow extends CommunityGameSourceRow {
  discordUserId: string;
}
export function projectCommunityGameUserSourceRow(row: {
  discordUserId: unknown;
  name: unknown;
  applicationId: unknown;
  totalSeconds: unknown;
}): CommunityGameUserSourceRow {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return { discordUserId: row.discordUserId, ...projectCommunityGameSourceRow(row) };
}
export interface CommunityGameGroup {
  key: string;
  canonicalName: string | null;
  applicationId: string | null;
  totalSeconds: number;
  secondsByName: Map<string, number>;
}
export function communityGameGroupDisplayName(group: CommunityGameGroup): string {
  if (group.canonicalName) return group.canonicalName;
  let best: string | null = null;
  let bestSeconds = -1;
  for (const [name, seconds] of group.secondsByName) {
    if (seconds > bestSeconds || (seconds === bestSeconds && best !== null && name < best)) {
      best = name;
      bestSeconds = seconds;
    }
  }
  return best ?? group.key;
}
export function communityGameGroupIdentity(group: CommunityGameGroup): CommunityGameIdentity {
  return {
    key: group.key,
    name: communityGameGroupDisplayName(group),
    applicationId: group.applicationId,
  };
}
function compareCommunityGameGroups(a: CommunityGameGroup, b: CommunityGameGroup): number {
  if (a.totalSeconds !== b.totalSeconds) return b.totalSeconds - a.totalSeconds;
  const byName = communityGameGroupDisplayName(a).localeCompare(communityGameGroupDisplayName(b));
  return byName !== 0 ? byName : a.key.localeCompare(b.key);
}
/**
 * Groups (name, applicationId) aggregate rows into unified
 * games, ordered like the v1–v4 games list (total seconds
 * descending) with the display name / key as deterministic
 * tie-breaks.
 */
export function groupCommunityGameRows(
  rows: readonly CommunityGameSourceRow[],
  mappings: readonly CommunityGameIdentityMapping[],
): CommunityGameGroup[] {
  const groups = new Map<string, CommunityGameGroup>();
  for (const row of rows) {
    const resolution = resolveCommunityGame(row.name, row.applicationId, mappings);
    let group = groups.get(resolution.key);
    if (!group) {
      group = {
        key: resolution.key,
        canonicalName: resolution.canonicalName,
        applicationId: resolution.applicationId,
        totalSeconds: 0,
        secondsByName: new Map(),
      };
      groups.set(resolution.key, group);
    }
    group.totalSeconds += row.totalSeconds;
    group.secondsByName.set(row.name, (group.secondsByName.get(row.name) ?? 0) + row.totalSeconds);
  }
  return [...groups.values()].sort(compareCommunityGameGroups);
}
/**
 * The v5 overview aggregation over per-user source rows:
 * the unified games with exact distinct player counts
 * (merging per-name counts would double-count members who
 * played under two names), and every user's total with
 * their top unified game. Users order by total descending
 * with the id as tie-break, exactly like the v1–v4 SQL.
 */
export function aggregateCommunityGamesOverviewV5(
  rows: readonly CommunityGameUserSourceRow[],
  mappings: readonly CommunityGameIdentityMapping[],
): {
  games: Array<{ identity: CommunityGameIdentity; totalSeconds: number; playerCount: number }>;
  users: Array<{
    discordUserId: string;
    totalSeconds: number;
    topGame: CommunityGameIdentity;
  }>;
} {
  const groups = groupCommunityGameRows(rows, mappings);
  const identityByKey = new Map(
    groups.map((group) => [group.key, communityGameGroupIdentity(group)]),
  );
  const playersByKey = new Map<string, Set<string>>();
  const totalsByUser = new Map<string, number>();
  const secondsByUserKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const { key } = resolveCommunityGame(row.name, row.applicationId, mappings);
    let players = playersByKey.get(key);
    if (!players) {
      players = new Set();
      playersByKey.set(key, players);
    }
    players.add(row.discordUserId);
    totalsByUser.set(
      row.discordUserId,
      (totalsByUser.get(row.discordUserId) ?? 0) + row.totalSeconds,
    );
    let byKey = secondsByUserKey.get(row.discordUserId);
    if (!byKey) {
      byKey = new Map();
      secondsByUserKey.set(row.discordUserId, byKey);
    }
    byKey.set(key, (byKey.get(key) ?? 0) + row.totalSeconds);
  }
  const users = [...totalsByUser.entries()]
    .map(([discordUserId, totalSeconds]) => {
      let topKey: string | null = null;
      let topSeconds = -1;
      for (const [key, seconds] of secondsByUserKey.get(discordUserId) ?? []) {
        const identity = identityByKey.get(key);
        if (!identity) continue;
        const topIdentity = topKey ? identityByKey.get(topKey) : undefined;
        if (
          seconds > topSeconds ||
          (seconds === topSeconds &&
            topIdentity &&
            (identity.name.localeCompare(topIdentity.name) < 0 ||
              (identity.name === topIdentity.name &&
                identity.key.localeCompare(topKey as string) < 0)))
        ) {
          topKey = key;
          topSeconds = seconds;
        }
      }
      return {
        discordUserId,
        totalSeconds,
        topGame: identityByKey.get(topKey as string) as CommunityGameIdentity,
      };
    })
    .sort(
      (a, b) => b.totalSeconds - a.totalSeconds || a.discordUserId.localeCompare(b.discordUserId),
    );
  return {
    games: groups.map((group) => ({
      identity: communityGameGroupIdentity(group),
      totalSeconds: group.totalSeconds,
      playerCount: playersByKey.get(group.key)?.size ?? 0,
    })),
    users,
  };
}
/**
 * The v5 matrix body: members ordered by their period
 * total (descending, id tie-break — the v3 member order),
 * with seconds summed across every source row of each
 * listed game. Rows for games outside the list are dropped,
 * never widen the shape (the v3 builder's rule).
 */
export function buildCommunityMatrixV5(
  games: readonly CommunityGameIdentity[],
  rows: readonly CommunityGameUserSourceRow[],
  mappings: readonly CommunityGameIdentityMapping[],
): CommunityMatrixMember[] {
  const gameIndex = new Map(games.map((game, index) => [game.key, index]));
  const totalsByUser = new Map<string, number>();
  const cellsByUser = new Map<string, number[]>();
  for (const row of rows) {
    totalsByUser.set(
      row.discordUserId,
      (totalsByUser.get(row.discordUserId) ?? 0) + row.totalSeconds,
    );
    const { key } = resolveCommunityGame(row.name, row.applicationId, mappings);
    const index = gameIndex.get(key);
    if (index === undefined) continue;
    let cells = cellsByUser.get(row.discordUserId);
    if (!cells) {
      cells = new Array<number>(games.length).fill(0);
      cellsByUser.set(row.discordUserId, cells);
    }
    cells[index] = (cells[index] ?? 0) + row.totalSeconds;
  }
  return [...totalsByUser.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([discordUserId]) => ({
      discordUserId,
      secondsByGame: cellsByUser.get(discordUserId) ?? new Array<number>(games.length).fill(0),
    }));
}
export interface CommunityGameFirstPlayRow {
  discordUserId: string;
  name: string;
  applicationId: string | null;
  firstDate: string;
}
export function projectCommunityGameFirstPlayRow(row: {
  discordUserId: unknown;
  name: unknown;
  applicationId: unknown;
  firstDate: unknown;
}): CommunityGameFirstPlayRow {
  if (typeof row.discordUserId !== 'string' || !/^\d{17,20}$/.test(row.discordUserId))
    throw new Error('InvalidCommunityGameUser');
  return {
    discordUserId: row.discordUserId,
    name: gameName(row.name),
    applicationId: gameApplicationId(row.applicationId),
    firstDate: toCommunityGameDateString(row.firstDate),
  };
}
/**
 * The v5 momentum merge: trailing-window seconds per
 * unified game, plus the members whose first observed
 * play of the game (over the whole history up to the
 * range end, resolved through the same unification) falls
 * inside the period. Aligned to the top-games order and
 * zero-filled, like the v3 merge.
 */
export function buildCommunityMomentumV5(
  games: readonly CommunityGameIdentity[],
  recentRows: readonly CommunityGameSourceRow[],
  firstPlays: readonly CommunityGameFirstPlayRow[],
  mappings: readonly CommunityGameIdentityMapping[],
  range: { from: string; to: string },
): CommunityGameMomentumItemV5[] {
  const recentByKey = new Map<string, number>();
  for (const group of groupCommunityGameRows(recentRows, mappings))
    recentByKey.set(group.key, group.totalSeconds);
  const firstByUserKey = new Map<string, Map<string, string>>();
  for (const row of firstPlays) {
    const { key } = resolveCommunityGame(row.name, row.applicationId, mappings);
    let byKey = firstByUserKey.get(row.discordUserId);
    if (!byKey) {
      byKey = new Map();
      firstByUserKey.set(row.discordUserId, byKey);
    }
    const known = byKey.get(key);
    if (known === undefined || row.firstDate < known) byKey.set(key, row.firstDate);
  }
  const newPlayersByKey = new Map<string, number>();
  for (const byKey of firstByUserKey.values()) {
    for (const [key, firstDate] of byKey) {
      if (firstDate < range.from || firstDate > range.to) continue;
      newPlayersByKey.set(key, (newPlayersByKey.get(key) ?? 0) + 1);
    }
  }
  return games.map((game) => ({
    ...game,
    recentSeconds: recentByKey.get(game.key) ?? 0,
    newPlayerCount: newPlayersByKey.get(game.key) ?? 0,
  }));
}
export interface CommunityGameDetailSourceRow extends CommunityGameUserSourceRow {
  firstPlayDate: string;
  lastPlayDate: string;
}
export function projectCommunityGameDetailSourceRow(row: {
  discordUserId: unknown;
  name: unknown;
  applicationId: unknown;
  totalSeconds: unknown;
  firstPlayDate: unknown;
  lastPlayDate: unknown;
}): CommunityGameDetailSourceRow {
  return {
    ...projectCommunityGameUserSourceRow(row),
    firstPlayDate: toCommunityGameDateString(row.firstPlayDate),
    lastPlayDate: toCommunityGameDateString(row.lastPlayDate),
  };
}
/**
 * The v5 user games list: the member's own rows unified
 * and ordered like the overview games list.
 */
export function buildCommunityUserGamesV5(
  rows: readonly CommunityGameSourceRow[],
  mappings: readonly CommunityGameIdentityMapping[],
): CommunityUserGameItemV5[] {
  return groupCommunityGameRows(rows, mappings).map((group) => ({
    ...communityGameGroupIdentity(group),
    totalSeconds: group.totalSeconds,
  }));
}
/**
 * v6 leaderboards shapes (S9, #1081), all aggregated from
 * community_game_activity_daily. The three boards widen the
 * ranking axes beyond raw volume: gameCount is breadth (how
 * many distinct unified games a member played), playDays is
 * continuity (on how many distinct dates they played — the
 * user insights playDays figure, ranked; streaks stay
 * personal-panel data and are never ranked, per the S5
 * decision), and growth is change (the absolute increase of
 * total play seconds against the previous period).
 *
 * The previous period of a range is the window of the same
 * length immediately before it — the same definition the
 * period comparison (G7) uses: this week against last week,
 * this month against last month. Growth only lists members
 * whose previous-period total reaches one hour and whose
 * increase is positive: with almost no previous record the
 * increase is noise (a first week always "grows"), and a
 * ranking of decreases is not a leaderboard. A range whose
 * previous period precedes observation — the cumulative
 * range starting at the first observed date — therefore
 * yields an empty growth ranking rather than fabricated
 * growth.
 *
 * gameCount counts unified games (the v5 identity), so a
 * game played under two names or ids counts once. Because
 * application_id recording only started with S7a, rows
 * before that unify by name only; counts over ranges
 * reaching back mix the two, which the contract states.
 */
export const COMMUNITY_LEADERBOARD_GROWTH_MIN_PREVIOUS_SECONDS = 3600;
export interface CommunityLeaderboardGameCountItem {
  discordUserId: string;
  gameCount: number;
}
export interface CommunityLeaderboardPlayDaysItem {
  discordUserId: string;
  playDays: number;
}
export interface CommunityLeaderboardGrowthItem {
  discordUserId: string;
  currentSeconds: number;
  previousSeconds: number;
  growthSeconds: number;
}
export interface CommunityLeaderboardPagination {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}
export interface CommunityLeaderboardsOverview {
  gameCount: {
    items: CommunityLeaderboardGameCountItem[];
    pagination: CommunityLeaderboardPagination;
  };
  playDays: {
    items: CommunityLeaderboardPlayDaysItem[];
    pagination: CommunityLeaderboardPagination;
  };
  growth: {
    items: CommunityLeaderboardGrowthItem[];
    pagination: CommunityLeaderboardPagination;
    previousRange: { from: string; to: string };
  };
}
function leaderboardUserId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{17,20}$/.test(value))
    throw new Error('InvalidCommunityLeaderboardUser');
  return value;
}
function leaderboardCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('InvalidCommunityLeaderboardCount');
  return value;
}
/**
 * Leaderboard projections follow the same rule as the game
 * and activity ones: only the selected columns, re-validated
 * field by field, aggregates through toCommunityGameSeconds
 * so an uncast SUM throws here (#1004). The growth
 * projection derives growthSeconds from the two totals; it
 * may be zero or negative — eligibility is the builder's
 * call, not the projection's.
 */
export function projectCommunityLeaderboardPlayDaysRow(row: {
  discordUserId: unknown;
  playDays: unknown;
}): CommunityLeaderboardPlayDaysItem {
  return {
    discordUserId: leaderboardUserId(row.discordUserId),
    playDays: leaderboardCount(row.playDays),
  };
}
export function projectCommunityLeaderboardGrowthRow(row: {
  discordUserId: unknown;
  currentSeconds: unknown;
  previousSeconds: unknown;
}): CommunityLeaderboardGrowthItem {
  const currentSeconds = toCommunityGameSeconds(row.currentSeconds);
  const previousSeconds = toCommunityGameSeconds(row.previousSeconds);
  return {
    discordUserId: leaderboardUserId(row.discordUserId),
    currentSeconds,
    previousSeconds,
    growthSeconds: currentSeconds - previousSeconds,
  };
}
/**
 * The window of the same length immediately before a
 * range: for a 7-day range the 7 days before it, for a
 * month range the same number of days before it. Pure date
 * arithmetic on the validated range; anything else is a
 * caller bug.
 */
export function communityGamePreviousRange(range: { from: string; to: string }): {
  from: string;
  to: string;
} {
  if (!date(range.from) || !date(range.to) || range.from > range.to)
    throw new Error('InvalidCommunityGameRange');
  const dayMs = 86_400_000;
  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  const toMs = Date.parse(`${range.to}T00:00:00Z`);
  const lengthDays = Math.round((toMs - fromMs) / dayMs) + 1;
  return {
    from: new Date(fromMs - lengthDays * dayMs).toISOString().slice(0, 10),
    to: new Date(fromMs - dayMs).toISOString().slice(0, 10),
  };
}
/**
 * The gameCount board: per member, the number of distinct
 * unified games among their source rows. Ordered by count
 * descending with the id as tie-break, like every other
 * ranking. Members without a row in the range never appear
 * (a zero-game entry is not data the daily table holds).
 */
export function buildCommunityLeaderboardGameCounts(
  rows: readonly CommunityGameUserSourceRow[],
  mappings: readonly CommunityGameIdentityMapping[],
): CommunityLeaderboardGameCountItem[] {
  const keysByUser = new Map<string, Set<string>>();
  for (const row of rows) {
    const { key } = resolveCommunityGame(row.name, row.applicationId, mappings);
    let keys = keysByUser.get(row.discordUserId);
    if (!keys) {
      keys = new Set();
      keysByUser.set(row.discordUserId, keys);
    }
    keys.add(key);
  }
  return [...keysByUser.entries()]
    .map(([discordUserId, keys]) => ({ discordUserId, gameCount: keys.size }))
    .sort((a, b) => b.gameCount - a.gameCount || a.discordUserId.localeCompare(b.discordUserId));
}
/**
 * The growth board: only members whose previous-period
 * total reaches the one-hour floor and whose seconds grew.
 * Ordered by the increase descending; ties break to the
 * larger current total (the bigger presence behind the
 * same growth), then to the id, so the order is total.
 */
export function buildCommunityLeaderboardGrowth(
  rows: readonly CommunityLeaderboardGrowthItem[],
): CommunityLeaderboardGrowthItem[] {
  return rows
    .filter(
      (row) =>
        row.previousSeconds >= COMMUNITY_LEADERBOARD_GROWTH_MIN_PREVIOUS_SECONDS &&
        row.growthSeconds > 0,
    )
    .sort(
      (a, b) =>
        b.growthSeconds - a.growthSeconds ||
        b.currentSeconds - a.currentSeconds ||
        a.discordUserId.localeCompare(b.discordUserId),
    );
}
/**
 * v7 channel mode shapes (S10, #1082): one channel's
 * member ranking from community_activity_channel_daily,
 * selected by channelId and metric exactly like the game
 * mode selects one game. The wire metric is `voice`
 * (voice_seconds stay) or `messages` (the cooldown-filtered
 * message count); the stored metric names stay a database
 * concern of the route. Items and the viewer carry the
 * metric's own field (totalSeconds / totalCount), like the
 * v2 activity rankings do. Channel names are resolved by
 * the route through the same guild-options lookup as the
 * v4 channels section and degrade to null.
 */
export const COMMUNITY_CHANNEL_METRICS = ['voice', 'messages'] as const;
export type CommunityChannelMetric = (typeof COMMUNITY_CHANNEL_METRICS)[number];
export interface CommunityChannelVoiceMemberItem {
  discordUserId: string;
  totalSeconds: number;
}
export interface CommunityChannelMessageMemberItem {
  discordUserId: string;
  totalCount: number;
}
export interface CommunityChannelViewer {
  discordUserId: string;
  rank: number | null;
  totalSeconds: number;
}
export interface CommunityChannelMessageViewer {
  discordUserId: string;
  rank: number | null;
  totalCount: number;
}
/**
 * Channel ranking projections follow the same rule as the
 * activity ones: only the selected columns, re-validated
 * field by field, aggregates through toCommunityGameSeconds
 * so an uncast SUM throws here (#1004).
 */
export function projectCommunityChannelVoiceMemberRow(row: {
  discordUserId: unknown;
  totalSeconds: unknown;
}): CommunityChannelVoiceMemberItem {
  return {
    discordUserId: activityUserId(row.discordUserId),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
export function projectCommunityChannelMessageMemberRow(row: {
  discordUserId: unknown;
  totalCount: unknown;
}): CommunityChannelMessageMemberItem {
  return {
    discordUserId: activityUserId(row.discordUserId),
    totalCount: toCommunityGameSeconds(row.totalCount),
  };
}
/**
 * v7 weekly champions shapes (S10, #1082): for every
 * Monday-start week the range touches, the week's leader
 * candidates by total play seconds from
 * community_game_activity_daily. The supply deliberately
 * returns this raw list and nothing derived from it: the
 * relay counts weekly titles (the hall of fame) from the
 * candidates, promoting the next one when a week's leader
 * is opted out — a supply-side count could never be
 * corrected that way, so no counts and no fixed champion
 * are ever baked in here. The candidate list is capped so
 * the relay has runner-ups to promote; five is headroom
 * over the handful of opt-outs the board has ever seen,
 * not a paging surface. weekStart is the week's Monday
 * and weekEnd its Sunday (JST calendar dates): the first
 * and last weeks may extend beyond the requested range,
 * and the candidates are ranked over the days inside the
 * range only. Weeks with no play inside the range are
 * omitted.
 */
export const COMMUNITY_WEEKLY_CHAMPION_LEADERS_LIMIT = 5;
export interface CommunityWeeklyChampionLeader {
  discordUserId: string;
  totalSeconds: number;
}
export interface CommunityWeeklyChampionWeek {
  weekStart: string;
  weekEnd: string;
  leaders: CommunityWeeklyChampionLeader[];
}
export interface CommunityWeeklyChampionsOverview {
  weeks: CommunityWeeklyChampionWeek[];
}
export interface CommunityWeeklyChampionRow {
  weekStart: string;
  discordUserId: string;
  totalSeconds: number;
}
export function projectCommunityWeeklyChampionRow(row: {
  weekStart: unknown;
  discordUserId: unknown;
  totalSeconds: unknown;
}): CommunityWeeklyChampionRow {
  return {
    weekStart: toCommunityGameDateString(row.weekStart),
    discordUserId: leaderboardUserId(row.discordUserId),
    totalSeconds: toCommunityGameSeconds(row.totalSeconds),
  };
}
function communityGameWeekEnd(weekStart: string): string {
  if (!date(weekStart)) throw new Error('InvalidCommunityGameDate');
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
}
/**
 * Assembles the weekly champions section from per-week,
 * per-member totals (the route groups by
 * date_trunc('week', activity_date), whose Monday is the
 * weekStart): weeks ascending, candidates by seconds
 * descending with the id as tie-break — the order every
 * ranking in this contract uses — capped at the leaders
 * limit. The builder re-sorts rather than trusting the
 * query order, like the growth builder.
 */
export function buildCommunityWeeklyChampions(
  rows: readonly CommunityWeeklyChampionRow[],
): CommunityWeeklyChampionWeek[] {
  const leadersByWeek = new Map<string, CommunityWeeklyChampionLeader[]>();
  for (const row of rows) {
    let leaders = leadersByWeek.get(row.weekStart);
    if (!leaders) {
      leaders = [];
      leadersByWeek.set(row.weekStart, leaders);
    }
    leaders.push({ discordUserId: row.discordUserId, totalSeconds: row.totalSeconds });
  }
  return [...leadersByWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, leaders]) => ({
      weekStart,
      weekEnd: communityGameWeekEnd(weekStart),
      leaders: leaders
        .sort(
          (a, b) =>
            b.totalSeconds - a.totalSeconds || a.discordUserId.localeCompare(b.discordUserId),
        )
        .slice(0, COMMUNITY_WEEKLY_CHAMPION_LEADERS_LIMIT),
    }));
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
    'channelId',
    'channelMetric',
    'discordUserId',
    'from',
    'gameApplicationId',
    'gameKey',
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
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6 &&
    version !== 7
  )
    return fail(422, 'invalid_request');
  const mode = value.mode === undefined ? 'overview' : value.mode;
  if (mode !== 'overview' && mode !== 'user' && mode !== 'game' && mode !== 'channel')
    return fail(422, 'invalid_request');
  const discordUserId = value.discordUserId === undefined ? null : value.discordUserId;
  if (mode === 'overview' && discordUserId !== null) return fail(422, 'invalid_request');
  if (mode === 'user' && (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId)))
    return fail(422, 'invalid_request');
  const gameName = value.gameName === undefined ? null : value.gameName;
  const gameApplicationId = value.gameApplicationId === undefined ? null : value.gameApplicationId;
  const gameKey = value.gameKey === undefined ? null : value.gameKey;
  const channelId = value.channelId === undefined ? null : value.channelId;
  const channelMetric = value.channelMetric === undefined ? null : value.channelMetric;
  if (mode === 'game') {
    // The game mode exists only in contract v3 and later,
    // names the one game to detail, and takes discordUserId
    // as an optional viewer whose rank is reported alongside
    // the players. v3/v4 select by exact gameName only; v5
    // adds the gameApplicationId / gameKey selectors for the
    // unified identity (S7b), and exactly one of the three
    // selectors must be present. v6 and v7 keep the v5
    // selectors and game shape unchanged.
    if (version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7)
      return fail(422, 'invalid_request');
    if (channelId !== null || channelMetric !== null) return fail(422, 'invalid_request');
    if (
      discordUserId !== null &&
      (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId))
    )
      return fail(422, 'invalid_request');
    const selectors = [gameName, gameApplicationId, gameKey].filter((entry) => entry !== null);
    if (selectors.length !== 1) return fail(422, 'invalid_request');
    if (
      gameName !== null &&
      (typeof gameName !== 'string' || gameName.trim() === '' || gameName.length > 128)
    )
      return fail(422, 'invalid_request');
    if (
      gameApplicationId !== null &&
      ((version !== 5 && version !== 6 && version !== 7) ||
        typeof gameApplicationId !== 'string' ||
        !/^\d{17,20}$/.test(gameApplicationId))
    )
      return fail(422, 'invalid_request');
    if (
      gameKey !== null &&
      ((version !== 5 && version !== 6 && version !== 7) ||
        typeof gameKey !== 'string' ||
        !isCommunityGameKey(gameKey))
    )
      return fail(422, 'invalid_request');
  } else if (mode === 'channel') {
    // The channel mode exists only in contract v7 (S10),
    // names the one channel and metric to rank, and takes
    // discordUserId as an optional viewer like the game
    // mode. Both selectors must be present; the game
    // selectors belong to the game mode only.
    if (version !== 7) return fail(422, 'invalid_request');
    if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId))
      return fail(422, 'invalid_request');
    if (
      typeof channelMetric !== 'string' ||
      !(COMMUNITY_CHANNEL_METRICS as readonly string[]).includes(channelMetric)
    )
      return fail(422, 'invalid_request');
    if (
      discordUserId !== null &&
      (typeof discordUserId !== 'string' || !/^\d{17,20}$/.test(discordUserId))
    )
      return fail(422, 'invalid_request');
    if (gameName !== null || gameApplicationId !== null || gameKey !== null)
      return fail(422, 'invalid_request');
  } else if (
    gameName !== null ||
    gameApplicationId !== null ||
    gameKey !== null ||
    channelId !== null ||
    channelMetric !== null
  )
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
    gameName: gameName as string | null,
    gameApplicationId: gameApplicationId as string | null,
    gameKey: gameKey as string | null,
    channelId: channelId as string | null,
    channelMetric: channelMetric as CommunityChannelMetric | null,
    version: version as CommunityGameStatsVersion,
  };
}
