import { createHmac, randomUUID } from 'node:crypto';

export interface CommonPointsConfig {
  secret: string;
  guildId: string;
}
export interface CommonPointsAccount {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}
export interface SettledPointEarning {
  guildId: string;
  discordUserId: string;
  amount: number;
  earningId: string;
  epoch: string;
  ruleVersion: string;
  occurredAt: string;
}

export function resolveCommonPointsConfig(
  env: Partial<Record<string, string | undefined>>,
): CommonPointsConfig | null {
  if (env['COMMON_POINTS_ENABLED'] !== 'true') return null;
  const secret = env['HERTA_POINTS_SECRET']?.trim(),
    guildId = env['HERTA_POINTS_GUILD_ID']?.trim();
  if (!secret || !guildId || !/^[0-9]{17,20}$/.test(guildId)) return null;
  return { secret, guildId };
}

/** Body/event ID come from a durable outbox; retries only refresh signing time. */
export function buildCommonPointsRequest(
  config: CommonPointsConfig,
  path: '/v1/points/herta/earn' | '/v1/points/herta/balance',
  body: string,
  eventId: string,
  timestamp = new Date().toISOString(),
): Request {
  if (
    (path !== '/v1/points/herta/earn' && path !== '/v1/points/herta/balance') ||
    Buffer.byteLength(body, 'utf8') > 8192
  )
    throw new Error('invalid_common_points_request');
  const parsed = JSON.parse(body) as { guildId?: unknown; discordUserId?: unknown };
  if (
    parsed.guildId !== config.guildId ||
    typeof parsed.discordUserId !== 'string' ||
    !/^[0-9]{17,20}$/.test(parsed.discordUserId) ||
    Buffer.byteLength(body, 'utf8') > 8192 ||
    !/^[0-9a-f-]{36}$/.test(eventId)
  )
    throw new Error('invalid_common_points_request');
  const signature = createHmac('sha256', config.secret)
    .update(`${timestamp}.${eventId}.POST.${path}.${body}`)
    .digest('hex');
  return new Request(`https://api.ivrm.jp${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': eventId,
      'X-IVRM-Signature': signature,
    },
    body,
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
    redirect: 'error',
  });
}

/** No fallback to activity scores. Callers must enforce Discord/session subject. */
export async function fetchCommonPointsBalance(
  config: CommonPointsConfig,
  guildId: string,
  discordUserId: string,
  fetcher: typeof fetch = fetch,
): Promise<CommonPointsAccount | null> {
  try {
    const request = buildCommonPointsRequest(
      config,
      '/v1/points/herta/balance',
      JSON.stringify({ guildId, discordUserId }),
      randomUUID(),
    );
    const response = await fetcher(request);
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 8192) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      status?: unknown;
      userId?: unknown;
      account?: CommonPointsAccount;
    };
    const account = value.account;
    if (
      value.status !== 'ok' ||
      typeof value.userId !== 'string' ||
      !account ||
      ![account.balance, account.lifetimeEarned, account.lifetimeSpent].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      )
    )
      return null;
    return account;
  } catch {
    return null;
  }
}
