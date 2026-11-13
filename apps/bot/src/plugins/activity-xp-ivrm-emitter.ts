import { createHash, createHmac } from 'node:crypto';
import type { Logger } from '@herta/logger';

/**
 * ivrm-web Points v3 Activity XP 取込 (Herta #877 / ivrm-web #965 X3) への送信モジュール。
 *
 * `member_activity_events` (Activity Log Plugin が記録する message_create /
 * voice_join / voice_leave) をユーザー×1時間窓で集約し、ivrm-web apps/api の
 * `POST /v1/xp/herta/events` へ署名付きで送る。Guild XP・ランキング・Role・
 * Community Points には一切触れない、読み取りと送信だけの追加機能。
 *
 * 署名方式は #569 の daily-bonus-wallet.ts と同一
 * (`${timestamp}.${eventId}.POST.${path}.${body}` の HMAC-SHA256)。
 * ただし eventId は ivrm-web 側が UUID 形式を要求するため、再送時も同じ値に
 * なるよう sourceEventId から決定的に導出する (ランダム UUID は使わない)。
 */

export const ACTIVITY_XP_REQUEST_PATH = '/v1/xp/herta/events';
const REQUEST_TIMEOUT_MS = 8_000;

export const ACTIVITY_XP_WINDOW_MS = 60 * 60 * 1000;
/** 窓が閉じてから集計対象にするまでの猶予。Activity Log の record 書き込み遅延を吸収する。 */
export const ACTIVITY_XP_WINDOW_GRACE_MS = 30_000;
/** 再送の上限回数。これを超えた行は failed として outbox に残す (自動では再送しない)。 */
export const ACTIVITY_XP_MAX_ATTEMPTS = 12;

export type ActivityXpEventType = 'message' | 'voice';

export interface ActivityXpEmitterConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-webの`HERTA_POINTS_SECRET`と同じ値を設定するHMAC共有鍵。 */
  secret: string;
  /** 送信対象のguild。`IVRM_INTEGRATION_GUILD_ID` と同じ単一guildのみを対象にする。 */
  guildId: string;
}

/**
 * `HERTA_XP_EMITTER_ENABLED=true` の場合のみ有効。未設定・false・必須env不足では
 * null を返し、Bot は送信ループ自体を開始しない (既定OFFのフェイルクローズド)。
 * URL検証は daily-bonus-wallet.ts / community-activity-ivrm-sync.ts と同じ方針。
 */
export function resolveActivityXpEmitterConfig(
  env: Partial<Record<string, string | undefined>>,
): ActivityXpEmitterConfig | null {
  if (env['HERTA_XP_EMITTER_ENABLED']?.trim() !== 'true') return null;
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_POINTS_SECRET']?.trim();
  const guildId = env['IVRM_INTEGRATION_GUILD_ID']?.trim();
  if (!rawUrl || !secret || !guildId) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret, guildId };
  } catch {
    return null;
  }
}

/** UTCの時間窓の開始時刻 (分以下を切り捨て)。JSTでも時境界はUTCと一致する。 */
export function activityXpHourWindowStart(date: Date): Date {
  const start = new Date(date.getTime());
  start.setUTCMinutes(0, 0, 0);
  return start;
}

/**
 * 直近に閉じた1時間窓 [start, end) を返す。graceMs 分だけ「閉じた」とみなす
 * 時刻を遅らせるため、境界直後の tick では1つ前の窓が対象になる。
 */
export function latestClosedActivityXpWindow(
  now: Date,
  graceMs: number = ACTIVITY_XP_WINDOW_GRACE_MS,
): { start: Date; end: Date } {
  const end = activityXpHourWindowStart(new Date(now.getTime() - graceMs));
  const start = new Date(end.getTime() - ACTIVITY_XP_WINDOW_MS);
  return { start, end };
}

/**
 * 窓ごとに安定した冪等キー。ivrm-web 側の (source, source_event_id) 一意制約で
 * 再送が冪等になる。再送で count が変わると payload conflict (409) になるため、
 * outbox には初回集計した body をそのまま保存し、再送では再集計しない。
 */
export function activityXpSourceEventId(
  eventType: ActivityXpEventType,
  guildId: string,
  discordUserId: string,
  windowStart: Date,
): string {
  const prefix = eventType === 'message' ? 'herta:msg' : 'herta:voice';
  return `${prefix}:${guildId}:${discordUserId}:${windowStart.toISOString()}`;
}

/**
 * sourceEventId から envelope の eventId (UUID) を決定的に導出する。
 * ivrm-web の取込は X-IVRM-Event-Id に UUID 形式 (version 1-5 / variant 8-b)
 * を要求し、sourceEventId そのものは使えないため、SHA-256 の先頭16バイトに
 * version 5 と variant ビットを立てて UUID 化する (UUIDv5 と同じビット配置)。
 */
export function deriveActivityXpEventId(sourceEventId: string): string {
  const digest = createHash('sha256').update(`herta-xp-event:${sourceEventId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ActivityXpOutboxPayload {
  sourceEventId: string;
  eventId: string;
  guildId: string;
  userId: string;
  eventType: ActivityXpEventType;
  /** 送信する JSON body そのもの。再送時の byte 一致 (payload_hash) のため outbox に保存する。 */
  body: string;
}

/**
 * 1件分の集計から outbox payload を作る。count が正の整数でない場合は null
 * (ivrm-web 側も count <= 0 を 422 で弾くため、そもそも enqueue しない)。
 * body のキーは ivrm-web の契約どおりの6キーちょうどにする。
 */
export function buildActivityXpOutboxPayload(input: {
  guildId: string;
  discordUserId: string;
  eventType: ActivityXpEventType;
  count: number;
  windowStart: Date;
}): ActivityXpOutboxPayload | null {
  if (!Number.isSafeInteger(input.count) || input.count <= 0) return null;
  const sourceEventId = activityXpSourceEventId(
    input.eventType,
    input.guildId,
    input.discordUserId,
    input.windowStart,
  );
  const body = JSON.stringify({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    eventType: input.eventType,
    count: input.count,
    sourceEventId,
    occurredAt: input.windowStart.toISOString(),
  });
  return {
    sourceEventId,
    eventId: deriveActivityXpEventId(sourceEventId),
    guildId: input.guildId,
    userId: input.discordUserId,
    eventType: input.eventType,
    body,
  };
}

export interface ActivityXpRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/** daily-bonus-wallet.ts と同じ canonical 文字列で署名する。ネットワークI/Oを含まない。 */
export function buildActivityXpRequest(
  config: ActivityXpEmitterConfig,
  eventId: string,
  body: string,
  timestamp: string,
): ActivityXpRequest {
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${ACTIVITY_XP_REQUEST_PATH}.${body}`)
    .digest('hex');
  return {
    url: `${config.apiBaseUrl}${ACTIVITY_XP_REQUEST_PATH}`,
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

export type ActivityXpDeliveryOutcome = 'sent' | 'dropped' | 'auth_failure' | 'retryable';

/**
 * ivrm-web 取込の応答分類。
 * - 201 (created) / 200 (idempotent replay) → 送信完了
 * - 409 (未連携ユーザー / payload競合) と 422 (ポリシー外 / 日次上限超過) は
 *   恒久扱い: 再送せず破棄し、件数だけ記録する。連携前の活動は遡及付与しない。
 * - 401 / 403 は設定異常 (secret・guild不整合) なので送信を止めて明示する。
 * - それ以外 (5xx・404等) とネットワーク失敗は outbox から再送する。
 */
export function classifyActivityXpResponse(status: number): ActivityXpDeliveryOutcome {
  if (status === 200 || status === 201) return 'sent';
  if (status === 401 || status === 403) return 'auth_failure';
  if (status === 409 || status === 422) return 'dropped';
  return 'retryable';
}

/** 再送までの指数バックオフ (30秒から倍増、上限1時間)。 */
export function activityXpRetryDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 10);
  return Math.min(30_000 * 2 ** exponent, 60 * 60 * 1000);
}

export interface VoiceActivityEvent {
  event: 'voice_join' | 'voice_leave';
  occurredAt: Date;
}

/**
 * voice_join / voice_leave の時系列から、窓 [windowStart, windowEnd) 内の
 * 接続分数 (分未満切り捨て) を求める純粋関数。
 *
 * - 窓より前の event も渡すこと。窓開始時点で接続中かどうかは、窓直前の
 *   最後の event で判定する (join のままなら接続中として窓開始から数える)。
 * - 窓終了時点で接続中なら窓終了までを数える。残りは次の窓で数えるため、
 *   窓をまたいでも二重計上・欠落はしない。
 * - join が重なった場合は最初の join を採用し (除外チャンネルからの leave が
 *   Activity Log に残らないケースの吸収)、join のない leave は無視する。
 */
export function computeVoiceMinutesInWindow(
  events: readonly VoiceActivityEvent[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  let openSinceMs: number | null = null;
  let totalSeconds = 0;

  const overlapSeconds = (fromMs: number, toMs: number): number => {
    const clipped = Math.min(toMs, endMs) - Math.max(fromMs, startMs);
    return clipped > 0 ? clipped / 1000 : 0;
  };

  for (const event of events) {
    const atMs = event.occurredAt.getTime();
    if (event.event === 'voice_join') {
      if (openSinceMs === null) openSinceMs = atMs;
    } else if (openSinceMs !== null) {
      totalSeconds += overlapSeconds(openSinceMs, atMs);
      openSinceMs = null;
    }
  }
  if (openSinceMs !== null) totalSeconds += overlapSeconds(openSinceMs, endMs);

  return Math.floor(totalSeconds / 60);
}

/**
 * outbox の1行分を送信し、応答分類を返す。例外は投げず、ネットワーク失敗は
 * retryable として扱う (呼び出し側のループを止めないため)。
 */
export async function sendActivityXpOutboxPayload(
  config: ActivityXpEmitterConfig,
  payload: Pick<ActivityXpOutboxPayload, 'eventId' | 'body'>,
  logger: Logger,
): Promise<{ outcome: ActivityXpDeliveryOutcome; status?: number; error?: string }> {
  const request = buildActivityXpRequest(
    config,
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
    return { outcome: classifyActivityXpResponse(response.status), status: response.status };
  } catch (error) {
    logger.warn(
      { err: error, eventId: payload.eventId },
      'Activity XP送信でリクエストに失敗しました',
    );
    return {
      outcome: 'retryable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
