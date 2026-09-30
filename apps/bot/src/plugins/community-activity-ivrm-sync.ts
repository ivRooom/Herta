import { createHmac } from 'node:crypto';
import type { Logger } from '@herta/logger';

const REQUEST_PATH = '/v1/herta/activity-events';
const REQUEST_TIMEOUT_MS = 5_000;

export interface ActivityIvrmSyncConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-webの`HERTA_ACTIVITY_SYNC_SECRET`と同じ値を設定するHMAC共有鍵。 */
  secret: string;
}

export interface ActivityIvrmSyncEvent {
  eventId: string;
  discordUserId: string;
  messagesTotal: number;
  voiceSecondsTotal: number;
  pointsTotal: number;
  occurredAt: string;
}

export interface ActivityIvrmSyncRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * `IVRM_WEB_API_BASE_URL` / `HERTA_ACTIVITY_SYNC_SECRET` のどちらかが未設定・不正な場合はnullを返す。
 * この機能はivrm-web (member.ivrm.jp) 連携が任意のため、未設定でも活動集計自体は動作し続ける。
 */
export function resolveActivityIvrmSyncConfig(
  env: Partial<Record<string, string | undefined>>,
): ActivityIvrmSyncConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_ACTIVITY_SYNC_SECRET']?.trim();
  if (!rawUrl || !secret) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { apiBaseUrl: rawUrl.replace(/\/+$/, ''), secret };
  } catch {
    return null;
  }
}

/**
 * ivrm-webの`herta-mbti-sync.ts` / `herta-activity-sync.ts`と同じHMAC-SHA256署名パターンで
 * signed requestを構築する。ネットワークI/Oを含まないため単体テストで検証できる。
 */
export function buildActivityIvrmSyncRequest(
  config: ActivityIvrmSyncConfig,
  event: ActivityIvrmSyncEvent,
  timestamp: string,
): ActivityIvrmSyncRequest {
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId: event.eventId,
    discordUserId: event.discordUserId,
    messagesTotal: event.messagesTotal,
    voiceSecondsTotal: event.voiceSecondsTotal,
    pointsTotal: event.pointsTotal,
    occurredAt: event.occurredAt,
  });
  const canonical = ['POST', REQUEST_PATH, timestamp, event.eventId, body].join('\n');
  const signature = createHmac('sha256', config.secret).update(canonical).digest('hex');

  return {
    url: `${config.apiBaseUrl}${REQUEST_PATH}`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IVRM-Timestamp': timestamp,
        'X-IVRM-Event-Id': event.eventId,
        'X-IVRM-Signature': signature,
      },
      body,
    },
  };
}

/**
 * Discordの応答をブロックしないfire-and-forget push。ivrm-web側が404(未連携/未承認)を
 * 返すケースは正常な無視対象のため、warnログの対象は5xx・network failure・timeoutのみとする。
 * 呼び出し側の定期同期ループを止めないよう、例外は投げずに握りつぶす。
 */
export async function pushActivityStatsToIvrmWeb(
  config: ActivityIvrmSyncConfig,
  event: ActivityIvrmSyncEvent,
  logger: Logger,
): Promise<void> {
  const request = buildActivityIvrmSyncRequest(config, event, new Date().toISOString());

  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      logger.warn(
        { status: response.status, eventId: event.eventId },
        'ivrm-webへの活動統計同期が失敗しました',
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, eventId: event.eventId },
      'ivrm-webへの活動統計同期でリクエストに失敗しました',
    );
  }
}
