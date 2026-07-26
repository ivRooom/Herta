import { z } from 'zod';

const publicServiceStatusSchema = z.enum([
  'operational',
  'degraded',
  'outage',
  'maintenance',
  'unknown',
]);

const internalCheckStatusSchema = z.enum([
  'ok',
  'warning',
  'error',
  'not_configured',
  'unknown',
]);

const baseCheckSchema = z
  .object({
    status: internalCheckStatusSchema,
    message: z.string().optional(),
  })
  .passthrough();

const dependencyCheckSchema = baseCheckSchema.extend({
  latency_ms: z.number().nonnegative().optional(),
});

export const botHealthResponseSchema = z.object({
  service: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
  status: publicServiceStatusSchema,
  checked_at: z.string().datetime(),
  uptime_seconds: z.number().nonnegative(),
  version: z.string(),
  checks: z.object({
    process: baseCheckSchema,
    discord: baseCheckSchema.extend({
      connected: z.boolean(),
      ready: z.boolean(),
      gateway_status: z.enum([
        'ready',
        'connecting',
        'reconnecting',
        'disconnected',
        'unknown',
      ]),
      reconnecting: z.boolean(),
      last_ready_at: z.string().datetime().nullable(),
      last_heartbeat_at: z.string().datetime().nullable(),
      last_disconnect_at: z.string().datetime().nullable(),
      heartbeat_source: z.enum(['gateway_status_observation', 'unknown']),
    }),
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
    worker: dependencyCheckSchema.extend({
      last_heartbeat_at: z.string().datetime().nullable().optional(),
    }),
  }),
});

export type BotHealthResponse = z.infer<typeof botHealthResponseSchema>;
export type BotCheckStatus = z.infer<typeof internalCheckStatusSchema>;
export type BotServiceStatus = z.infer<typeof publicServiceStatusSchema>;

export type BotHealthResult =
  | {
      available: true;
      health: BotHealthResponse;
      httpStatus: number;
      fetchedAt: string;
    }
  | {
      available: false;
      reason: 'not_configured' | 'unreachable' | 'invalid_response';
      fetchedAt: string;
    };

const REQUEST_TIMEOUT_MS = 4_000;

export function parseBotHealthResponse(value: unknown): BotHealthResponse | null {
  const parsed = botHealthResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Botコンテナの内部向け /healthz をServer Componentから取得する。
 * URLや通信エラーの詳細は画面へ露出させず、運用状態だけを返す。
 */
export async function getBotHealth(): Promise<BotHealthResult> {
  const fetchedAt = new Date().toISOString();
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();

  if (!healthUrl) {
    return { available: false, reason: 'not_configured', fetchedAt };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    const health = parseBotHealthResponse(payload);

    if (!health) {
      return { available: false, reason: 'invalid_response', fetchedAt };
    }

    return {
      available: true,
      health,
      httpStatus: response.status,
      fetchedAt,
    };
  } catch {
    return { available: false, reason: 'unreachable', fetchedAt };
  } finally {
    clearTimeout(timeout);
  }
}
