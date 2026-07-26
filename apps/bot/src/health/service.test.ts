import { createLogger } from '@herta/logger';
import { describe, expect, it } from 'vitest';
import type { HealthConfig } from './config.js';
import { HertaHealthService } from './service.js';
import type { DiscordHealthObservation } from './types.js';

const config: HealthConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 3000,
  checkTimeoutMs: 50,
  cacheTtlMs: 0,
  heartbeatStaleMs: 120_000,
};
const logger = createLogger({ name: 'health-test', level: 'silent' });
const now = new Date('2026-07-25T11:30:00.000Z');

function discordObservation(
  overrides: Partial<DiscordHealthObservation> = {},
): DiscordHealthObservation {
  return {
    connected: true,
    ready: true,
    gatewayStatus: 'ready',
    reconnecting: false,
    lastReadyAt: new Date('2026-07-25T11:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-07-25T11:29:42.000Z'),
    lastDisconnectAt: null,
    heartbeatSource: 'gateway_status_observation',
    ...overrides,
  };
}

function createService(options: {
  discord?: DiscordHealthObservation;
  guildCount?: () => number;
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
  workerHeartbeat?: () => Promise<string | null>;
}) {
  return new HertaHealthService({
    config,
    logger,
    version: '1.0.0',
    now: () => now,
    uptimeSeconds: () => 43_200,
    probes: {
      discord: () => options.discord ?? discordObservation(),
      guildCount: options.guildCount ?? (() => 3),
      ...(options.database ? { database: options.database } : {}),
      ...(options.redis ? { redis: options.redis } : {}),
      ...(options.workerHeartbeat ? { workerHeartbeat: options.workerHeartbeat } : {}),
    },
  });
}

describe('HertaHealthService', () => {
  it('すべて正常ならoperationalと参加Guild数を返す', async () => {
    const service = createService({
      database: async () => undefined,
      redis: async () => undefined,
      workerHeartbeat: async () => '2026-07-25T11:29:50.000Z',
    });

    const response = await service.getHealth();
    expect(response.status).toBe('operational');
    expect(response.guild_count).toBe(3);
    expect(response.checks.database.status).toBe('ok');
    expect(response.checks.worker.status).toBe('ok');
  });

  it('Guild数の取得に失敗しても0件として応答する', async () => {
    const service = createService({
      guildCount: () => {
        throw new Error('guild cache unavailable');
      },
    });

    const response = await service.getHealth();
    expect(response.guild_count).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    '不正なGuild数 %s を0件として応答する',
    async (invalidGuildCount) => {
      const service = createService({ guildCount: () => invalidGuildCount });
      const response = await service.getHealth();
      expect(response.guild_count).toBe(0);
    },
  );

  it('Heartbeat期限超過ならoutageを返す', async () => {
    const service = createService({
      discord: discordObservation({
        lastHeartbeatAt: new Date('2026-07-25T11:27:00.000Z'),
      }),
      database: async () => undefined,
    });

    const response = await service.getHealth();
    expect(response.status).toBe('outage');
    expect(response.checks.discord.status).toBe('error');
  });

  it('Worker heartbeat期限超過ならdegradedを返す', async () => {
    const service = createService({
      database: async () => undefined,
      redis: async () => undefined,
      workerHeartbeat: async () => '2026-07-25T11:27:00.000Z',
    });

    const response = await service.getHealth();
    expect(response.status).toBe('degraded');
    expect(response.checks.worker.status).toBe('error');
  });

  it('未設定Redisをnot_configuredとして返す', async () => {
    const service = createService({ database: async () => undefined });
    const response = await service.getHealth();
    expect(response.checks.redis).toEqual({ status: 'not_configured' });
    expect(response.checks.worker).toEqual({ status: 'not_configured' });
  });

  it('依存チェック例外を安全なレスポンスへ正規化する', async () => {
    const secret = 'postgresql://admin:super-secret@10.0.0.1/herta';
    const service = createService({
      database: async () => {
        throw new Error(secret);
      },
    });

    const response = await service.getHealth();
    const serialized = JSON.stringify(response);
    expect(response.status).toBe('outage');
    expect(response.checks.database).toEqual({
      status: 'error',
      message: 'dependency check failed',
    });
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('10.0.0.1');
  });

  it('タイムアウトしても応答を返す', async () => {
    const service = createService({
      database: () => new Promise<void>(() => undefined),
    });

    const response = await service.getHealth();
    expect(response.status).toBe('outage');
    expect(response.checks.database.status).toBe('error');
  });
});
