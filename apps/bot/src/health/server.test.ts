import { createLogger } from '@herta/logger';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthConfig } from './config.js';
import { HealthHttpServer, type HealthHttpServerOptions } from './server.js';
import type { HertaHealthResponse, PublicServiceStatus } from './types.js';

const logger = createLogger({ name: 'health-http-test', level: 'silent' });
const servers: HealthHttpServer[] = [];
const INTERNAL_SECRET = '0123456789abcdef0123456789abcdef';
const GUILD_ID = '123456789012345678';

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
    guild_count: 3,
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

type ExtraOptions = Pick<
  HealthHttpServerOptions,
  'internalApiSecret' | 'getGuildBotProfile' | 'updateGuildBotProfile'
>;

async function startServer(
  getHealth: () => Promise<HertaHealthResponse>,
  extraOptions: ExtraOptions = {},
) {
  const server = new HealthHttpServer({
    config: config(),
    logger,
    version: '1.0.0',
    getHealth,
    now: () => new Date('2026-07-25T11:30:00.000Z'),
    uptimeSeconds: () => 100,
    ...extraOptions,
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
    expect((await result.json()) as HertaHealthResponse).toMatchObject({
      status: 'operational',
      guild_count: 3,
    });
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

describe('internal guild bot profile API', () => {
  const profile = {
    userId: '987654321098765432',
    username: 'Herta',
    nickname: 'Herta Bot',
    avatarUrl: null,
    guildAvatar: false,
  };

  it('Secret未設定時は内部APIを公開しない', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      getGuildBotProfile: async () => profile,
    });
    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`);
    expect(result.status).toBe(503);
  });

  it('Bearer Secretが一致しない場合は401を返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      getGuildBotProfile: async () => profile,
    });
    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(result.status).toBe(401);
  });

  it('認証済みGETでプロフィールを返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      getGuildBotProfile: async () => profile,
    });
    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`, {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ profile });
  });

  it('認証済みPATCHで検証済み入力だけを更新関数へ渡す', async () => {
    let received: unknown = null;
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      updateGuildBotProfile: async (_guildId, input) => {
        received = input;
        return { ...profile, nickname: input.nickname };
      },
    });
    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${INTERNAL_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: 'New Herta' }),
    });
    expect(result.status).toBe(200);
    expect(received).toEqual({ nickname: 'New Herta' });
  });

  it('不正なPATCH bodyは400を返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      updateGuildBotProfile: async () => profile,
    });
    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${INTERNAL_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: 'x'.repeat(33) }),
    });
    expect(result.status).toBe(400);
  });
});
