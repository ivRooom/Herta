import { createHmac, timingSafeEqual } from 'node:crypto';
import { aggregateValorantStats, type DrawSample } from './valorant-stats.js';

/**
 * VALORANT ポータル向け Herta 側サービス API (S6-H1、Herta #1050)。
 *
 * ivrm-web のメンバー API が actor (Discord ID) を確定し、この API が
 * セッションの読み取りと統計を返す。方向は S1 (Herta → ivrm-web の
 * Bot API) と逆だが、認証は S1 と同じ HMAC 方式に揃える:
 * - ヘッダ `X-IVRM-Timestamp` / `X-IVRM-Event-Id` / `X-IVRM-Signature`
 * - 署名対象 `${timestamp}.${eventId}.${method}.${pathname}.${body}`
 *   の HMAC-SHA256 (hex)
 * - 時計ずれ ±5 分、body 上限 8KB (S1 と同水準)
 * - 秘密は S6 専用の `HERTA_PORTAL_API_SECRET` で、S1 の
 *   `HERTA_TROLL_BOT_SECRET` とは分ける (署名方向が逆のため)
 *
 * actor の Discord ID は署名済み body の一部としてのみ信頼する。
 * `isAdmin` は呼び出し側に申告させず、Guild メンバーの権限
 * (Administrator || ManageGuild) から Herta 側で算出する。
 * 対象 Guild は単一前提でリクエストでは受けず、Herta 側設定
 * (`IVRM_INTEGRATION_GUILD_ID`、既存の ivrm 連携プラグインと同じ
 * env) で固定する。
 *
 * 読み取りも POST で統一する: 署名対象に method / pathname / body を
 * 含める S1 の検証形式をそのまま再利用でき、actor を body で渡す
 * 読み取り (履歴など) と形式が揃うため。
 *
 * 応答形式は S1 と揃える: 成功 `{ status: "ok", ... }`、エラーは
 * HTTP ステータス + `{ status: "error", error: <code> }`。
 * エラー応答には内部情報 (例外内容・スタック等) を含めない。
 *
 * S6-H1 の範囲は読み取り系のみ。mutation (create / join / draw 等) は
 * S6-H2 で同じ transport へ追加する。人狼 (WEREWOLF) セッションは
 * S6-W までポータルへ出さない (一覧・詳細・履歴・統計すべてで除外)。
 */

export const VALORANT_PORTAL_API_PREFIX = '/portal/valorant';
export const VALORANT_PORTAL_MAX_BODY_BYTES = 8 * 1024;
export const VALORANT_PORTAL_SIGNATURE_WINDOW_MS = 5 * 60 * 1_000;
export const VALORANT_PORTAL_STATS_MAX_DRAWS = 5_000;
export const VALORANT_PORTAL_STATS_RETENTION_DAYS = 90;
export const VALORANT_PORTAL_HISTORY_DEFAULT_LIMIT = 20;
export const VALORANT_PORTAL_HISTORY_MAX_LIMIT = 50;
export const VALORANT_PORTAL_ACTOR_SESSIONS_LIMIT = 20;

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

// ---------------------------------------------------------------------------
// 設定 (env)。リスナーは既定 OFF で、ON のときだけ起動する
// ---------------------------------------------------------------------------

export interface ValorantPortalApiConfig {
  /** `VALORANT_PORTAL_API_ENABLED=true` のときだけ true (既定 OFF) */
  enabled: boolean;
  host: string;
  port: number;
  /** S6 専用 HMAC 秘密。値そのものはコード・ログへ出さない */
  secret: string | null;
  /** 対象 Guild (単一前提)。`IVRM_INTEGRATION_GUILD_ID` から読む */
  guildId: string | null;
}

export const VALORANT_PORTAL_API_DEFAULT_PORT = 3_100;

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return VALORANT_PORTAL_API_DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
    return VALORANT_PORTAL_API_DEFAULT_PORT;
  }
  return parsed;
}

export function loadValorantPortalApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ValorantPortalApiConfig {
  const guildId = env['IVRM_INTEGRATION_GUILD_ID']?.trim() ?? '';
  const secret = env['HERTA_PORTAL_API_SECRET']?.trim() ?? '';
  return {
    enabled: env['VALORANT_PORTAL_API_ENABLED']?.trim().toLowerCase() === 'true',
    host: env['VALORANT_PORTAL_API_HOST']?.trim() || '127.0.0.1',
    port: parsePort(env['VALORANT_PORTAL_API_PORT']),
    secret: secret.length > 0 ? secret : null,
    guildId: DISCORD_ID_PATTERN.test(guildId) ? guildId : null,
  };
}

/** リスナーを起動できる設定か (有効化 + 秘密 + Guild が揃っている) */
export function isValorantPortalApiConfigured(
  config: ValorantPortalApiConfig,
): config is ValorantPortalApiConfig & { secret: string; guildId: string } {
  return config.enabled && config.secret !== null && config.guildId !== null;
}

// ---------------------------------------------------------------------------
// HMAC 認証 (S1 の herta-troll-service-auth と同じ署名形式)
// ---------------------------------------------------------------------------

export interface ValorantPortalSignatureInput {
  secret: string;
  timestamp: string;
  eventId: string;
  method: string;
  pathname: string;
  body: string;
}

export function computeValorantPortalSignature(input: ValorantPortalSignatureInput): string {
  return createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.eventId}.${input.method}.${input.pathname}.${input.body}`)
    .digest('hex');
}

export interface ValorantPortalAuthHeaders {
  timestamp: string | undefined;
  eventId: string | undefined;
  signature: string | undefined;
}

/**
 * 署名を検証する。ヘッダ欠落・形式不正・時計ずれ超過・署名不一致は
 * すべて false (呼び出し側は理由を区別せず一律 401 で拒否する)。
 */
export function verifyValorantPortalRequest(input: {
  secret: string;
  method: string;
  pathname: string;
  body: string;
  headers: ValorantPortalAuthHeaders;
  nowMs?: number;
}): boolean {
  const { headers } = input;
  if (!headers.timestamp || !headers.eventId || !headers.signature) return false;
  if (!/^\d{1,20}$/.test(headers.timestamp)) return false;
  const timestampMs = Number(headers.timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > VALORANT_PORTAL_SIGNATURE_WINDOW_MS) return false;
  if (!/^[0-9a-f]{64}$/.test(headers.signature)) return false;
  const expected = computeValorantPortalSignature({
    secret: input.secret,
    timestamp: headers.timestamp,
    eventId: headers.eventId,
    method: input.method,
    pathname: input.pathname,
    body: input.body,
  });
  const actualBytes = Buffer.from(headers.signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

// ---------------------------------------------------------------------------
// 依存 (Guild 解決と DB)。Bot 本体が実装し、テストでは fake を差す
// ---------------------------------------------------------------------------

export interface ValorantPortalMemberInfo {
  userId: string;
  displayName: string;
  /** Administrator || ManageGuild を Herta 側で算出した結果 */
  isAdmin: boolean;
}

export interface ValorantPortalChannelOption {
  id: string;
  name: string;
}

export interface ValorantPortalGuildPort {
  /** Guild メンバーでなければ null (actor の即時拒否に使う) */
  getMember(userId: string): Promise<ValorantPortalMemberInfo | null>;
  /** Bot が投稿できるテキストチャンネル候補 */
  listPostableTextChannels(): Promise<readonly ValorantPortalChannelOption[]>;
  listVoiceChannels(): Promise<readonly ValorantPortalChannelOption[]>;
  /** 表示名の解決。解決できない ID は Map に含めない */
  resolveDisplayNames(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface ValorantPortalSessionParticipantRow {
  sessionId: string;
  userId: string;
  joinedAt: Date;
}

export interface ValorantPortalSessionRow {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  status: string;
  mode: string;
  mapId: string | null;
  voiceChannelId: string | null;
  trollOffUserIds: string[];
  vcAutoJoin: boolean;
  maxParticipants: number;
  expiresAt: Date;
  completedAt: Date | null;
  candidates: unknown;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  participants: ValorantPortalSessionParticipantRow[];
}

/** Bot の PrismaClient が満たす最小インターフェース (テスト fake 用) */
export interface ValorantPortalPrisma {
  valorantPickSession: {
    findMany(args: unknown): Promise<ValorantPortalSessionRow[]>;
    findFirst(args: unknown): Promise<ValorantPortalSessionRow | null>;
  };
}

export interface ValorantPortalDeps {
  prisma: ValorantPortalPrisma;
  guild: ValorantPortalGuildPort;
  guildId: string;
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ValorantPortalSessionDto {
  id: string;
  status: string;
  mode: string;
  mapId: string | null;
  channelId: string;
  messageId: string | null;
  voiceChannelId: string | null;
  vcAutoJoin: boolean;
  creatorId: string;
  creatorDisplayName: string | null;
  maxParticipants: number;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  participants: { userId: string; displayName: string | null; joinedAt: string }[];
  result: unknown;
  trollOffUserIds: string[];
  /**
   * actor から見た権限ヒント。表示専用であり、最終判定は mutation 側
   * (S6-H2 以降は repository) が行う。ここでの値を根拠に操作を許可
   * してはならない。
   */
  permissions: {
    isCreator: boolean;
    isAdmin: boolean;
    isParticipant: boolean;
    canDraw: boolean;
    canCancel: boolean;
    canJoin: boolean;
    canLeave: boolean;
  };
}

function buildSessionDto(
  row: ValorantPortalSessionRow,
  actor: ValorantPortalMemberInfo,
  displayNames: ReadonlyMap<string, string>,
): ValorantPortalSessionDto {
  const isCreator = row.creatorId === actor.userId;
  const isParticipant = row.participants.some((p) => p.userId === actor.userId);
  const isOpen = row.status === 'OPEN';
  const canManage = isCreator || actor.isAdmin;
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    mapId: row.mapId,
    channelId: row.channelId,
    messageId: row.messageId,
    voiceChannelId: row.voiceChannelId,
    vcAutoJoin: row.vcAutoJoin,
    creatorId: row.creatorId,
    creatorDisplayName: displayNames.get(row.creatorId) ?? null,
    maxParticipants: row.maxParticipants,
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    participants: row.participants.map((p) => ({
      userId: p.userId,
      displayName: displayNames.get(p.userId) ?? null,
      joinedAt: p.joinedAt.toISOString(),
    })),
    result: row.result ?? null,
    trollOffUserIds: [...row.trollOffUserIds],
    permissions: {
      isCreator,
      isAdmin: actor.isAdmin,
      isParticipant,
      canDraw: isOpen && canManage,
      canCancel: isOpen && canManage,
      canJoin: isOpen && !isParticipant && row.participants.length < row.maxParticipants,
      canLeave: isOpen && isParticipant,
    },
  };
}

async function buildSessionDtos(
  deps: ValorantPortalDeps,
  rows: readonly ValorantPortalSessionRow[],
  actor: ValorantPortalMemberInfo,
): Promise<ValorantPortalSessionDto[]> {
  const userIds = new Set<string>();
  for (const row of rows) {
    userIds.add(row.creatorId);
    for (const participant of row.participants) userIds.add(participant.userId);
  }
  const displayNames = await deps.guild.resolveDisplayNames([...userIds]);
  return rows.map((row) => buildSessionDto(row, actor, displayNames));
}

// ---------------------------------------------------------------------------
// ハンドラ
// ---------------------------------------------------------------------------

export interface ValorantPortalResponse {
  httpStatus: number;
  payload: Record<string, unknown>;
}

function ok(payload: Record<string, unknown>): ValorantPortalResponse {
  return { httpStatus: 200, payload: { status: 'ok', ...payload } };
}

function error(httpStatus: number, code: string): ValorantPortalResponse {
  return { httpStatus, payload: { status: 'error', error: code } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return VALORANT_PORTAL_HISTORY_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(VALORANT_PORTAL_HISTORY_MAX_LIMIT, Math.floor(value)));
}

const PARTICIPANT_ORDER = [{ joinedAt: 'asc' }, { userId: 'asc' }] as const;

async function handleChannels(deps: ValorantPortalDeps): Promise<ValorantPortalResponse> {
  const [textChannels, voiceChannels] = await Promise.all([
    deps.guild.listPostableTextChannels(),
    deps.guild.listVoiceChannels(),
  ]);
  return ok({
    textChannels: textChannels.map((channel) => ({ id: channel.id, name: channel.name })),
    voiceChannels: voiceChannels.map((channel) => ({ id: channel.id, name: channel.name })),
  });
}

async function handleSessionsList(
  deps: ValorantPortalDeps,
  actor: ValorantPortalMemberInfo,
): Promise<ValorantPortalResponse> {
  const [openSessions, actorSessions] = await Promise.all([
    deps.prisma.valorantPickSession.findMany({
      where: { guildId: deps.guildId, status: 'OPEN', mode: { not: 'WEREWOLF' } },
      orderBy: [{ expiresAt: 'asc' }],
      include: { participants: { orderBy: PARTICIPANT_ORDER } },
    }),
    deps.prisma.valorantPickSession.findMany({
      where: {
        guildId: deps.guildId,
        mode: { not: 'WEREWOLF' },
        OR: [{ creatorId: actor.userId }, { participants: { some: { userId: actor.userId } } }],
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: VALORANT_PORTAL_ACTOR_SESSIONS_LIMIT,
      include: { participants: { orderBy: PARTICIPANT_ORDER } },
    }),
  ]);
  const openIds = new Set(openSessions.map((row) => row.id));
  const related = actorSessions.filter((row) => !openIds.has(row.id));
  const [open, relatedDtos] = await Promise.all([
    buildSessionDtos(deps, openSessions, actor),
    buildSessionDtos(deps, related, actor),
  ]);
  return ok({ openSessions: open, actorSessions: relatedDtos });
}

async function handleSessionsGet(
  deps: ValorantPortalDeps,
  actor: ValorantPortalMemberInfo,
  body: Record<string, unknown>,
): Promise<ValorantPortalResponse> {
  const sessionId = body['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return error(400, 'invalid_request');
  }
  const row = await deps.prisma.valorantPickSession.findFirst({
    where: { id: sessionId, guildId: deps.guildId },
    include: { participants: { orderBy: PARTICIPANT_ORDER } },
  });
  // 人狼セッションは S6-W までポータルへ出さない (存在自体を伏せる)
  if (!row || row.mode === 'WEREWOLF') return error(404, 'not_found');
  const [session] = await buildSessionDtos(deps, [row], actor);
  return ok({ session });
}

async function handleStats(deps: ValorantPortalDeps): Promise<ValorantPortalResponse> {
  // Studio の stats route と同じ読み取り条件に揃える
  const draws = await deps.prisma.valorantPickSession.findMany({
    where: { guildId: deps.guildId, status: 'COMPLETED', mode: { not: 'WEREWOLF' } },
    orderBy: { completedAt: 'desc' },
    take: VALORANT_PORTAL_STATS_MAX_DRAWS + 1,
    select: {
      id: true,
      mode: true,
      mapId: true,
      completedAt: true,
      candidates: true,
      result: true,
    },
  });
  const samples: DrawSample[] = draws.slice(0, VALORANT_PORTAL_STATS_MAX_DRAWS).map((row) => ({
    id: row.id,
    mode: row.mode,
    mapId: row.mapId,
    completedAt: row.completedAt,
    candidates: row.candidates,
    result: row.result,
  }));
  return ok({
    stats: {
      ...aggregateValorantStats(samples),
      truncated: draws.length > VALORANT_PORTAL_STATS_MAX_DRAWS,
      retentionDays: VALORANT_PORTAL_STATS_RETENTION_DAYS,
    },
  });
}

async function handleHistory(
  deps: ValorantPortalDeps,
  actor: ValorantPortalMemberInfo,
  body: Record<string, unknown>,
): Promise<ValorantPortalResponse> {
  const limit = parseLimit(body['limit']);
  const rows = await deps.prisma.valorantPickSession.findMany({
    where: {
      guildId: deps.guildId,
      status: 'COMPLETED',
      mode: { not: 'WEREWOLF' },
      participants: { some: { userId: actor.userId } },
    },
    orderBy: [{ completedAt: 'desc' }],
    take: limit,
    include: { participants: { orderBy: PARTICIPANT_ORDER } },
  });
  const sessions = await buildSessionDtos(deps, rows, actor);
  return ok({ sessions, retentionDays: VALORANT_PORTAL_STATS_RETENTION_DAYS });
}

export const VALORANT_PORTAL_ROUTES = [
  `${VALORANT_PORTAL_API_PREFIX}/channels`,
  `${VALORANT_PORTAL_API_PREFIX}/sessions/list`,
  `${VALORANT_PORTAL_API_PREFIX}/sessions/get`,
  `${VALORANT_PORTAL_API_PREFIX}/stats`,
  `${VALORANT_PORTAL_API_PREFIX}/history`,
] as const;

/**
 * 認証済みリクエストの処理本体。署名検証はサーバー層
 * (`valorant-portal-server.ts`) が先に行う前提で、ここでは body の
 * actor を検証し、Guild メンバーでない actor を即時拒否する。
 * 例外は投げず、内部エラーは `unavailable` に倒す (詳細は出さない)。
 */
export async function handleValorantPortalRequest(
  deps: ValorantPortalDeps,
  pathname: string,
  body: unknown,
): Promise<ValorantPortalResponse> {
  if (!isRecord(body)) return error(400, 'invalid_request');
  const actorId = body['actorDiscordUserId'];
  if (typeof actorId !== 'string' || !DISCORD_ID_PATTERN.test(actorId)) {
    return error(400, 'invalid_request');
  }
  let actor: ValorantPortalMemberInfo | null;
  try {
    actor = await deps.guild.getMember(actorId);
  } catch {
    return error(503, 'unavailable');
  }
  if (!actor) return error(403, 'actor_not_in_guild');
  try {
    switch (pathname) {
      case `${VALORANT_PORTAL_API_PREFIX}/channels`:
        return await handleChannels(deps);
      case `${VALORANT_PORTAL_API_PREFIX}/sessions/list`:
        return await handleSessionsList(deps, actor);
      case `${VALORANT_PORTAL_API_PREFIX}/sessions/get`:
        return await handleSessionsGet(deps, actor, body);
      case `${VALORANT_PORTAL_API_PREFIX}/stats`:
        return await handleStats(deps);
      case `${VALORANT_PORTAL_API_PREFIX}/history`:
        return await handleHistory(deps, actor, body);
      default:
        return error(404, 'not_found');
    }
  } catch {
    return error(503, 'unavailable');
  }
}
