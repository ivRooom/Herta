import type { HealthChecks, InternalCheckStatus, PublicServiceStatus } from './types.js';

function isDegradedStatus(status: InternalCheckStatus): boolean {
  return status === 'warning' || status === 'error' || status === 'unknown';
}

/** 公開ステータスの判定を一箇所へ集約する。 */
export function resolveOverallHealth(checks: HealthChecks): PublicServiceStatus {
  if (
    checks.discord.status === 'error' ||
    !checks.discord.connected ||
    !checks.discord.ready ||
    checks.database.status === 'error'
  ) {
    return 'outage';
  }

  if (checks.discord.status === 'unknown' || checks.database.status === 'unknown') {
    return 'unknown';
  }

  if (
    checks.database.status === 'not_configured' ||
    isDegradedStatus(checks.database.status) ||
    isDegradedStatus(checks.redis.status) ||
    isDegradedStatus(checks.worker.status)
  ) {
    return 'degraded';
  }

  return 'operational';
}

export function resolveHealthReason(checks: HealthChecks): keyof HealthChecks | 'unknown' {
  if (checks.discord.status !== 'ok' || !checks.discord.connected || !checks.discord.ready) {
    return 'discord';
  }
  if (checks.database.status !== 'ok') return 'database';
  if (!['ok', 'not_configured'].includes(checks.redis.status)) return 'redis';
  if (!['ok', 'not_configured'].includes(checks.worker.status)) return 'worker';
  return 'unknown';
}
