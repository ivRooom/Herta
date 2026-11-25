import { createHash, createHmac } from 'node:crypto';
import type { Logger } from '@herta/logger';

/**
 * ivrm-web チケット連携 (contracts v1 / Herta #749 S3) の送信モジュール。
 *
 * Discord の起票・スレッド紐付け・返信を ivrm-web apps/api の Herta 連携
 * エンドポイントへ届ける。署名は契約 v1 の現行形式
 * `HMAC(secret, "METHOD\nPATH\ntimestamp\neventId\nbody")` (hex) で、
 * secret は env `HERTA_TICKET_SECRET` (Web 側 SSM `/ivrm/api/herta-ticket-secret`
 * と同値)。未設定なら連携自体を無効とし、起票は fail-closed で案内する。
 *
 * 配送は作成だけが同期的 (ticketId と閲覧 URL がスレッド作成に必要なため) で、
 * 紐付けと返信は outbox (tickets-outbox-repository) 経由の永続配送にする。
 * eventId は sourceEventId から決定的に導出する UUID で、再送でも変わらない。
 */

export const TICKET_CREATE_PATH = '/v1/herta/tickets';
export const TICKET_THREAD_PATH = '/v1/herta/tickets/thread';
export const TICKET_MESSAGES_PATH = '/v1/herta/tickets/messages';
export const TICKET_REQUEST_PATHS = {
  create: TICKET_CREATE_PATH,
  thread: TICKET_THREAD_PATH,
  message: TICKET_MESSAGES_PATH,
} as const;

export type TicketOutboxKind = keyof typeof TICKET_REQUEST_PATHS;

const REQUEST_TIMEOUT_MS = 8_000;

/** 再送の上限回数。これを超えた行は failed として outbox に残す。 */
export const TICKET_MAX_ATTEMPTS = 12;

/** Web 側の検証上限 (契約 v1): 件名 160 字 / 本文 4000 字。 */
export const TICKET_SUBJECT_MAX_LENGTH = 160;
export const TICKET_BODY_MAX_LENGTH = 4000;

export type TicketCategory = 'discord' | 'game_server' | 'privacy' | 'general';

export const TICKET_CATEGORIES: ReadonlyArray<{ value: TicketCategory; label: string }> = [
  { value: 'discord', label: 'Discord全般' },
  { value: 'game_server', label: 'ゲーム・サーバー' },
  { value: 'privacy', label: 'プライバシー・データ削除' },
  { value: 'general', label: 'その他' },
];

export function isTicketCategory(value: unknown): value is TicketCategory {
  return TICKET_CATEGORIES.some((category) => category.value === value);
}

export function ticketCategoryLabel(category: TicketCategory): string {
  return TICKET_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'その他';
}

export interface TicketsPluginConfig {
  enabled: boolean;
  panelChannelId: string | null;
  staffRoleIds: string[];
  notifyChannelId: string | null;
  notifyStaffOnCreate: boolean;
  enabledCategories: TicketCategory[];
}

const SNOWFLAKE_PATTERN = /^\d+$/;

export function normalizeTicketsConfig(value: unknown): TicketsPluginConfig {
  const source = isRecord(value) ? value : {};
  const categoryFlags: Array<[TicketCategory, unknown, boolean]> = [
    ['discord', source.categoryDiscordEnabled, true],
    ['game_server', source.categoryGameServerEnabled, true],
    ['privacy', source.categoryPrivacyEnabled, true],
    ['general', source.categoryGeneralEnabled, true],
  ];
  return {
    enabled: source.enabled === undefined ? true : source.enabled === true,
    panelChannelId: snowflakeOrNull(source.panelChannelId),
    staffRoleIds: Array.isArray(source.staffRoleIds)
      ? [
          ...new Set(
            source.staffRoleIds.filter(
              (id): id is string => typeof id === 'string' && SNOWFLAKE_PATTERN.test(id),
            ),
          ),
        ].slice(0, 10)
      : [],
    notifyChannelId: snowflakeOrNull(source.notifyChannelId),
    notifyStaffOnCreate:
      source.notifyStaffOnCreate === undefined ? true : source.notifyStaffOnCreate === true,
    enabledCategories: categoryFlags
      .filter(([, flag, fallback]) => (flag === undefined ? fallback : flag === true))
      .map(([category]) => category),
  };
}

export interface TicketBridgeConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-web の `HERTA_TICKET_SECRET` と同じ値を設定する HMAC 共有鍵。 */
  secret: string;
}

/**
 * `IVRM_WEB_API_BASE_URL` と `HERTA_TICKET_SECRET` が両方そろった場合のみ有効。
 * どちらか欠ければ null を返し、起票は fail-closed の案内だけを返す
 * (Web 側も secret 未設定時は 503 で止まる設計で対になっている)。
 */
export function resolveTicketBridgeConfig(
  env: Partial<Record<string, string | undefined>>,
): TicketBridgeConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_TICKET_SECRET']?.trim();
  if (!rawUrl || !secret) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

/**
 * sourceEventId から envelope の eventId (UUID) を決定的に導出する。
 * Web 側は X-IVRM-Event-Id に UUID 形式を要求するため、Activity XP emitter と
 * 同じく SHA-256 の先頭16バイトに version 5 / variant ビットを立てる。
 */
export function deriveTicketEventId(sourceEventId: string): string {
  const digest = createHash('sha256').update(`herta-ticket-event:${sourceEventId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TicketSignedRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/** 契約 v1 の canonical 文字列で署名する。ネットワークI/Oを含まない。 */
export function buildTicketRequest(
  config: TicketBridgeConfig,
  path: string,
  eventId: string,
  body: string,
  timestamp: string,
): TicketSignedRequest {
  const signature = createHmac('sha256', config.secret)
    .update(['POST', path, timestamp, eventId, body].join('\n'))
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${path}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

export interface TicketCreatePayload {
  sourceEventId: string;
  eventId: string;
  body: string;
}

/**
 * 起票 body を作る。キーは契約 v1 の create-request の範囲だけにし、
 * 契約に無いフィールドは足さない。channel/thread は起票時点では未確定のため
 * 送らず、作成後の /thread で紐付ける。
 */
export function buildTicketCreatePayload(input: {
  /** モーダル送信インタラクションのID。起票ごとに一意で、冪等キーの種にする。 */
  submissionId: string;
  discordUserId: string;
  requesterName?: string | null;
  category: TicketCategory;
  subject: string;
  body: string;
}): TicketCreatePayload {
  const sourceEventId = `ticket-create:${input.submissionId}`;
  const body = JSON.stringify({
    discordUserId: input.discordUserId,
    ...(input.requesterName ? { requesterName: input.requesterName } : {}),
    category: input.category,
    subject: input.subject,
    body: input.body,
  });
  return { sourceEventId, eventId: deriveTicketEventId(sourceEventId), body };
}

export interface TicketOutboxPayload {
  sourceEventId: string;
  eventId: string;
  kind: TicketOutboxKind;
  ticketId: string;
  body: string;
}

/** スレッド紐付け (/thread) の outbox payload。Discord メッセージIDが冪等キー。 */
export function buildTicketThreadPayload(input: {
  ticketId: string;
  discordChannelId: string;
  discordThreadId: string;
}): TicketOutboxPayload {
  const sourceEventId = `ticket-thread:${input.ticketId}:${input.discordThreadId}`;
  const body = JSON.stringify({
    ticketId: input.ticketId,
    discordChannelId: input.discordChannelId,
    discordThreadId: input.discordThreadId,
  });
  return {
    sourceEventId,
    eventId: deriveTicketEventId(sourceEventId),
    kind: 'thread',
    ticketId: input.ticketId,
    body,
  };
}

/**
 * 返信取込 (/messages) の outbox payload。Discord メッセージIDが冪等キー。
 * 契約 v1 の message-request に authorKind は無い (サーバー側がチケット正本
 * から導出する) ため、Herta 側の申告フィールドは一切足さない。
 */
export function buildTicketMessagePayload(input: {
  ticketId: string;
  authorDiscordUserId: string;
  discordMessageId: string;
  body: string;
}): TicketOutboxPayload {
  const sourceEventId = `ticket-msg:${input.discordMessageId}`;
  const body = JSON.stringify({
    ticketId: input.ticketId,
    authorDiscordUserId: input.authorDiscordUserId,
    discordMessageId: input.discordMessageId,
    body: input.body,
  });
  return {
    sourceEventId,
    eventId: deriveTicketEventId(sourceEventId),
    kind: 'message',
    ticketId: input.ticketId,
    body,
  };
}

export interface TicketAttachmentRef {
  name: string;
  url: string;
}

/**
 * 添付は第1段では参照のみ: 実体は再ホストせず、ファイル名と URL を本文末尾へ
 * 付記して Web 側の記録に残す。本文は契約上限 (4000字) を超えないよう、
 * 付記込みで切り詰める。
 */
export function buildTicketMessageBody(
  content: string,
  attachments: readonly TicketAttachmentRef[],
): string {
  const suffix =
    attachments.length > 0
      ? attachments.map((file) => `\n[添付] ${file.name}: ${file.url}`).join('')
      : '';
  const base = content.trim();
  const combined = `${base}${suffix}`;
  if (combined.length <= TICKET_BODY_MAX_LENGTH) return combined;
  return `${combined.slice(0, TICKET_BODY_MAX_LENGTH - 1)}…`;
}

export type TicketDeliveryOutcome = 'sent' | 'dropped' | 'auth_failure' | 'retryable';

/**
 * Web 側応答の分類。
 * - 201 (created) / 200 (idempotent replay・duplicate) → 送信完了
 * - 401 は署名不整合 = 設定異常なので送信を止めて明示する
 * - 403 は messages 経路の actor 判定 (依頼者でも担当者でもない投稿者) など
 *   その行限りの恒久拒否として破棄する (行を残して理由を記録)
 * - 409 / 422 も恒久扱いで破棄。それ以外 (5xx・404等) とネットワーク失敗は再送
 */
export function classifyTicketResponse(status: number): TicketDeliveryOutcome {
  if (status === 200 || status === 201) return 'sent';
  if (status === 401) return 'auth_failure';
  if (status === 403 || status === 409 || status === 422) return 'dropped';
  return 'retryable';
}

/** 再送までの指数バックオフ (30秒から倍増、上限1時間)。Activity XP と同じ形。 */
export function ticketRetryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 10);
  return Math.min(30_000 * 2 ** exponent, 60 * 60 * 1000);
}

export interface TicketCreateResult {
  ticketId: string;
  created: boolean;
  url: string | null;
}

export type TicketCreateOutcome =
  | { kind: 'created'; result: TicketCreateResult }
  | { kind: 'unavailable' }
  | { kind: 'rejected'; status: number }
  | { kind: 'retryable'; status?: number; error?: string };

/**
 * 起票だけは同期で送る (ticketId と閲覧 URL がスレッド作成に必要なため)。
 * eventId は呼び出し側が決定的に導出したものを渡し、同一送信の再試行では
 * Web 側の冪等 replay (200 / created=false / url=null) が返る。
 */
export async function sendTicketCreate(
  config: TicketBridgeConfig,
  payload: TicketCreatePayload,
  logger: Logger,
): Promise<TicketCreateOutcome> {
  const request = buildTicketRequest(
    config,
    TICKET_CREATE_PATH,
    payload.eventId,
    payload.body,
    new Date().toISOString(),
  );
  let response: Response;
  try {
    response = await fetch(request.url, {
      ...request.init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ err: error, eventId: payload.eventId }, 'チケット作成リクエストに失敗しました');
    return {
      kind: 'retryable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (response.status === 503) return { kind: 'unavailable' };
  if (response.status === 200 || response.status === 201) {
    const parsed = (await response.json().catch(() => null)) as {
      ticketId?: unknown;
      created?: unknown;
      url?: unknown;
    } | null;
    if (!parsed || typeof parsed.ticketId !== 'string') {
      return { kind: 'retryable', status: response.status, error: 'invalid_create_response' };
    }
    return {
      kind: 'created',
      result: {
        ticketId: parsed.ticketId,
        created: parsed.created === true,
        url: typeof parsed.url === 'string' ? parsed.url : null,
      },
    };
  }
  const outcome = classifyTicketResponse(response.status);
  if (outcome === 'dropped' || outcome === 'auth_failure') {
    return { kind: 'rejected', status: response.status };
  }
  return { kind: 'retryable', status: response.status };
}

/**
 * outbox の1行分を送信し、応答分類を返す。例外は投げず、ネットワーク失敗は
 * retryable として扱う (呼び出し側のループを止めないため)。
 */
export async function sendTicketOutboxPayload(
  config: TicketBridgeConfig,
  payload: Pick<TicketOutboxPayload, 'kind' | 'eventId' | 'body'>,
  logger: Logger,
): Promise<{ outcome: TicketDeliveryOutcome; status?: number; error?: string }> {
  const request = buildTicketRequest(
    config,
    TICKET_REQUEST_PATHS[payload.kind],
    payload.eventId,
    payload.body,
    new Date().toISOString(),
  );
  try {
    const response = await fetch(request.url, {
      ...request.init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { outcome: classifyTicketResponse(response.status), status: response.status };
  } catch (error) {
    logger.warn({ err: error, eventId: payload.eventId }, 'チケット配送リクエストに失敗しました');
    return {
      outcome: 'retryable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function snowflakeOrNull(value: unknown): string | null {
  return typeof value === 'string' && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
