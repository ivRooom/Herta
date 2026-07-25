import { describe, expect, it } from 'vitest';
import { resolveOverallHealth } from './status.js';
import type { HealthChecks } from './types.js';

function healthyChecks(): HealthChecks {
  return {
    process: { status: 'ok' },
    discord: {
      status: 'ok',
      connected: true,
      ready: true,
      gateway_status: 'ready',
      reconnecting: false,
      last_ready_at: '2026-07-25T11:00:00.000Z',
      last_heartbeat_at: '2026-07-25T11:29:42.000Z',
      last_disconnect_at: null,
      heartbeat_source: 'gateway_status_observation',
    },
    database: { status: 'ok' },
    redis: { status: 'ok' },
    worker: { status: 'ok', last_heartbeat_at: '2026-07-25T11:29:50.000Z' },
  };
}

describe('resolveOverallHealth', () => {
  it('すべて正常ならoperationalを返す', () => {
    expect(resolveOverallHealth(healthyChecks())).toBe('operational');
  });

  it('Discord切断ならoutageを返す', () => {
    const checks = healthyChecks();
    checks.discord = { ...checks.discord, status: 'error', connected: false, ready: false };
    expect(resolveOverallHealth(checks)).toBe('outage');
  });

  it('任意依存サービスの異常ならdegradedを返す', () => {
    const checks = healthyChecks();
    checks.redis = { status: 'error', message: 'dependency check failed' };
    expect(resolveOverallHealth(checks)).toBe('degraded');
  });

  it('必須DB異常ならoutageを返す', () => {
    const checks = healthyChecks();
    checks.database = { status: 'error', message: 'dependency check failed' };
    expect(resolveOverallHealth(checks)).toBe('outage');
  });

  it('未設定Redisはoperational判定を妨げない', () => {
    const checks = healthyChecks();
    checks.redis = { status: 'not_configured' };
    expect(resolveOverallHealth(checks)).toBe('operational');
  });
});
