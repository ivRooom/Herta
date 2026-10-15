import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';

const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export interface MbtiRoleReconciliationResult {
  type: string;
  addedRoleId: string | null;
  addedRoleName: string | null;
  removedRoleIds: string[];
  skippedRoleIds: string[];
  failedRoleIds: string[];
}

export class MbtiRoleReconciliationError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`MBTI Role reconciliation request failed (${status})`);
    this.name = 'MbtiRoleReconciliationError';
    this.status = status;
  }
}

/**
 * apps/bot/src/health/server.tsの`/internal/guilds/:guildId/mbti/role-reconciliation`を
 * 呼び、Web回答完了時のDiscord Role付与をBotプロセスへ委ねる(StudioはBotトークンを
 * 持たないため)。呼び出し元(complete route)はこれをベストエフォート扱いとし、
 * 失敗しても診断結果の表示自体は止めない。
 */
export async function reconcileMbtiRoleForWebQuiz(
  guildId: string,
  discordUserId: string,
  resultType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MbtiRoleReconciliationResult> {
  const url = resolveBotInternalMbtiRoleReconciliationUrl(guildId);
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!url || !secret || secret.length < MIN_INTERNAL_API_SECRET_LENGTH) {
    throw new MbtiRoleReconciliationError(503);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ discordUserId, resultType }),
      cache: 'no-store',
      // Bot側のDiscord mutation完了を待つが、無期限には待たない(/completeがこれを
      // ベストエフォートでawaitするため、無期限だとBotが応答を返さない限りリクエストが
      // ハングし続ける)。/complete側のクライアントタイムアウト(15秒)を超えないよう、
      // ivrm-web同期(5秒)と合わせても収まる範囲に短く抑える。
      signal: AbortSignal.timeout(resolveBotHealthRequestTimeoutMs() + 3_000),
    });
  } catch {
    throw new MbtiRoleReconciliationError(502);
  }

  if (!response.ok) {
    if (response.status === 404) throw new MbtiRoleReconciliationError(404);
    if (response.status === 429) throw new MbtiRoleReconciliationError(429);
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      throw new MbtiRoleReconciliationError(503);
    }
    throw new MbtiRoleReconciliationError(502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MbtiRoleReconciliationError(502);
  }

  const result = isRecord(payload) ? parseMbtiRoleReconciliationResult(payload.result) : null;
  if (!result) throw new MbtiRoleReconciliationError(502);
  return result;
}

function resolveBotInternalMbtiRoleReconciliationUrl(guildId: string): string | null {
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl || !/^\d{17,20}$/u.test(guildId)) return null;

  try {
    const url = new URL(healthUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `/internal/guilds/${guildId}/mbti/role-reconciliation`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseMbtiRoleReconciliationResult(value: unknown): MbtiRoleReconciliationResult | null {
  if (!isRecord(value)) return null;

  const { type, addedRoleId, addedRoleName, removedRoleIds, skippedRoleIds, failedRoleIds } = value;
  if (typeof type !== 'string') return null;
  if (addedRoleId !== null && typeof addedRoleId !== 'string') return null;
  if (addedRoleName !== null && typeof addedRoleName !== 'string') return null;
  if (
    !isStringArray(removedRoleIds) ||
    !isStringArray(skippedRoleIds) ||
    !isStringArray(failedRoleIds)
  ) {
    return null;
  }

  return { type, addedRoleId, addedRoleName, removedRoleIds, skippedRoleIds, failedRoleIds };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
