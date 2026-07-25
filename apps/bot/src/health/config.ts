export interface HealthConfig {
  enabled: boolean;
  host: string;
  port: number;
  checkTimeoutMs: number;
  cacheTtlMs: number;
  heartbeatStaleMs: number;
}

const DEFAULTS: HealthConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 3000,
  checkTimeoutMs: 3_000,
  cacheTtlMs: 5_000,
  heartbeatStaleMs: 120_000,
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export function loadHealthConfig(env: NodeJS.ProcessEnv = process.env): HealthConfig {
  return {
    enabled: parseBoolean(env['HEALTH_ENABLED'], DEFAULTS.enabled),
    host: env['HEALTH_HOST']?.trim() || DEFAULTS.host,
    port: parseInteger(env['HEALTH_PORT'], DEFAULTS.port, 1, 65_535),
    checkTimeoutMs: parseInteger(
      env['HEALTH_CHECK_TIMEOUT_MS'],
      DEFAULTS.checkTimeoutMs,
      100,
      60_000,
    ),
    cacheTtlMs: parseInteger(env['HEALTH_CACHE_TTL_MS'], DEFAULTS.cacheTtlMs, 0, 60_000),
    heartbeatStaleMs: parseInteger(
      env['HEALTH_HEARTBEAT_STALE_MS'],
      DEFAULTS.heartbeatStaleMs,
      5_000,
      3_600_000,
    ),
  };
}
