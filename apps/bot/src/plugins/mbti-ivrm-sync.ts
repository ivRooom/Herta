import { createHmac } from 'node:crypto';
import type { Logger } from '@herta/logger';

const REQUEST_PATH = '/v1/herta/mbti-events';
const REQUEST_TIMEOUT_MS = 5_000;

export interface MbtiIvrmSyncConfig {
  /** ivrm-web apps/api のベースURL (末尾スラッシュなし)。例: https://api.ivrm.jp */
  apiBaseUrl: string;
  /** ivrm-webの`HERTA_MBTI_SYNC_SECRET`と同じ値を設定するHMAC共有鍵。 */
  secret: string;
}

export interface MbtiIvrmSyncEvent {
  eventId: string;
  discordUserId: string;
  mbtiType: string;
  occurredAt: string;
}

export interface MbtiIvrmSyncRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
}

/**
 * `IVRM_WEB_API_BASE_URL` / `HERTA_MBTI_SYNC_SECRET` のどちらかが未設定・不正な場合はnullを返す。
 * この機能はivrm-web (member.ivrm.jp) 連携が任意のため、未設定でもMBTI診断自体は動作し続ける。
 */
export function resolveMbtiIvrmSyncConfig(
  env: Partial<Record<string, string | undefined>>,
): MbtiIvrmSyncConfig | null {
  const rawUrl = env['IVRM_WEB_API_BASE_URL']?.trim();
  const secret = env['HERTA_MBTI_SYNC_SECRET']?.trim();
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
 * ivrm-webの`minecraft-activity.ts` / `herta-mbti-sync.ts`と同じHMAC-SHA256署名パターンで
 * signed requestを構築する。ネットワークI/Oを含まないため単体テストで検証できる。
 */
export function buildMbtiIvrmSyncRequest(
  config: MbtiIvrmSyncConfig,
  event: MbtiIvrmSyncEvent,
  timestamp: string,
): MbtiIvrmSyncRequest {
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId: event.eventId,
    discordUserId: event.discordUserId,
    mbtiType: event.mbtiType,
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
 * 呼び出し側の診断完了フローを止めないよう、例外は投げずに握りつぶす。
 */
export async function pushMbtiResultToIvrmWeb(
  config: MbtiIvrmSyncConfig,
  event: MbtiIvrmSyncEvent,
  logger: Logger,
): Promise<void> {
  const request = buildMbtiIvrmSyncRequest(config, event, new Date().toISOString());

  try {
    const response = await fetch(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      logger.warn(
        { status: response.status, eventId: event.eventId },
        'ivrm-webへのMBTI結果同期が失敗しました',
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, eventId: event.eventId },
      'ivrm-webへのMBTI結果同期でリクエストに失敗しました',
    );
  }
}
