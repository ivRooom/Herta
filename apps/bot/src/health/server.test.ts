import { createLogger } from '@herta/logger';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthConfig } from './config.js';
import { HealthHttpServer } from './server.js';
import type { HertaHealthResponse, PublicServiceStatus } from './types.js';

const logger = createLogger({ name: 'health-http-test', level: 'silent' });
const servers: HealthHttpServer[] = [];

function config(): HealthConfig {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    checkTimeoutMs: 50,
    cacheTtlMs: 0,
    heartbeatStaleMs: 120_000,
  };
}

function response(status: PublicServiceStatus): HertaHealthResponse {
  return {
    service: { id: 'herta-discord-bot', name: 'Herta', type: 'discord_bot' },
    status,
    checked_at: '2026-07-25T11:30:00.000Z',
    uptime_seconds: 100,
    version: '1.0.0',
    checks: {
      process: { status: 'ok' },
      discord: {
        status: status === 'outage' ? 'error' : 'ok',
        connected: status !== 'outage',
        ready: status !== 'outage',
        gateway_status: status === 'outage' ? 'disconnected' : 'ready',
        reconnecting: false,
        last_ready_at: '2026-07-25T11:00:00.000Z',
        last_heartbeat_at: '2026-07-25T11:29:42.000Z',
        last_disconnect_at: null,
        heartbeat_source: 'gateway_status_observation',
      },
      database: { status: 'ok' },
      redis: { status: status === 'degraded' ? 'error' : 'ok' },
      worker: { status: 'ok' },
    },
  };
}

async function startServer(getHealth: () => Promise<HertaHealthResponse>) {
  const server = new HealthHttpServer({
    config: config(),
    logger,
    version: '1.0.0',
    getHealth,
    now: () => new Date('2026-07-25T11:30:00.000Z'),
    uptimeSeconds: () => 100,
  });
  servers.push(server);
  await server.start();
  const address = server.getAddress();
  if (!address) throw new Error('server address is unavailable');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
});

describe('GET /healthz', () => {
  it('正常時はJSONと200を返す', async () => {
    const baseUrl = await startServer(async () => response('operational'));
    const result = await fetch(`${baseUrl}/healthz`);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('application/json');
    expect((await result.json()) as HertaHealthResponse).toMatchObject({ status: 'operational' });
  });

  it('degraded時も200を返す', async () => {
    const baseUrl = await startServer(async () => response('degraded'));
    const result = await fetch(`${baseUrl}/healthz`);
    expect(result.status).toBe(200);
  });

  it('outage時は503を返す', async () => {
    const baseUrl = await startServer(async () => response('outage'));
    const result = await fetch(`${baseUrl}/healthz`);
    expect(result.status).toBe(503);
  });

  it('タイムアウト時もunknownのJSONを返す', async () => {
    const baseUrl = await startServer(() => new Promise<HertaHealthResponse>(() => undefined));
    const result = await fetch(`${baseUrl}/healthz`);
    expect(result.status).toBe(503);
    expect((await result.json()) as HertaHealthResponse).toMatchObject({ status: 'unknown' });
  });

  it('想定外の例外でもプロセスを終了せずunknownを返す', async () => {
    const baseUrl = await startServer(async () => {
      throw new Error('unexpected secret stack');
    });
    const result = await fetch(`${baseUrl}/healthz`);
    const body = await result.text();
    expect(result.status).toBe(503);
    expect(body).toContain('"status":"unknown"');
    expect(body).not.toContain('unexpected secret stack');
  });
});
