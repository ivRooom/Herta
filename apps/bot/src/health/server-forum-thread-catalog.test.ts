import { createLogger } from '@herta/logger';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthConfig } from './config.js';
import { HealthHttpServer } from './server.js';
import type { HertaHealthResponse } from './types.js';

const logger = createLogger({ name: 'forum-thread-catalog-http-test', level: 'silent' });
const servers: HealthHttpServer[] = [];
const INTERNAL_SECRET = '0123456789abcdef0123456789abcdef';
const GUILD_ID = '123456789012345678';
const FORUM_ID = '223456789012345678';
const previousToken = process.env['DISCORD_BOT_TOKEN'];

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

function health(): HertaHealthResponse {
  return {
    service: { id: 'herta-discord-bot', name: 'Herta', type: 'discord_bot' },
    status: 'operational',
    checked_at: '2026-08-18T11:00:00.000Z',
    uptime_seconds: 100,
    version: '1.0.0',
    guild_count: 1,
    checks: {
      process: { status: 'ok' },
      discord: {
        status: 'ok',
        connected: true,
        ready: true,
        gateway_status: 'ready',
        reconnecting: false,
        last_ready_at: '2026-08-18T10:00:00.000Z',
        last_heartbeat_at: '2026-08-18T10:59:42.000Z',
        last_disconnect_at: null,
        heartbeat_source: 'gateway_status_observation',
      },
      database: { status: 'ok' },
      redis: { status: 'ok' },
      worker: { status: 'ok' },
    },
  };
}

async function startServer(internalApiSecret?: string): Promise<string> {
  const server = new HealthHttpServer({
    config: config(),
    logger,
    version: '1.0.0',
    getHealth: async () => health(),
    internalApiSecret,
  });
  servers.push(server);
  await server.start();
  const address = server.getAddress();
  if (!address) throw new Error('server address is unavailable');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (previousToken === undefined) delete process.env['DISCORD_BOT_TOKEN'];
  else process.env['DISCORD_BOT_TOKEN'] = previousToken;
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
});

describe('archived Forum Thread internal API', () => {
  const path = `/internal/guilds/${GUILD_ID}/message-studio/forums/${FORUM_ID}/threads`;

  it('Secret未設定時は503を返す', async () => {
    const baseUrl = await startServer();
    const result = await fetch(`${baseUrl}${path}`);
    expect(result.status).toBe(503);
  });

  it('Bearer Secretが一致しない場合は401を返す', async () => {
    const baseUrl = await startServer(INTERNAL_SECRET);
    const result = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(result.status).toBe(401);
  });

  it('GET以外を405で拒否しDiscordへ到達しない', async () => {
    const baseUrl = await startServer(INTERNAL_SECRET);
    const result = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(result.status).toBe(405);
    expect(result.headers.get('allow')).toBe('GET');
  });

  it('不正なbefore cursorをDiscordへ送信する前に400で拒否する', async () => {
    process.env['DISCORD_BOT_TOKEN'] = 'test-token';
    const baseUrl = await startServer(INTERNAL_SECRET);
    const result = await fetch(`${baseUrl}${path}?before=not-a-date`, {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ status: 'invalid_before' });
  });
});
