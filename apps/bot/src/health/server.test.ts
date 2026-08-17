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
  | 'internalApiSecret'
  | 'getGuildOptions'
  | 'searchGuildMembers'
  | 'getGuildBotProfile'
  | 'updateGuildBotProfile'
>;

async function startServer(
  getHealth: () => Promise<HertaHealthResponse>,
  extraOptions: ExtraOptions = {},
  configOverrides: Partial<HealthConfig> = {},
) {
  const server = new HealthHttpServer({
    config: { ...config(), ...configOverrides },
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

describe('internal guild options API', () => {
  const options = {
    guildId: GUILD_ID,
    guildName: 'Herta Test Guild',
    channels: [],
    messageTargets: [],
    roles: [],
    emojis: [],
    bot: {
      manageMessages: true,
      manageRoles: true,
      moderateMembers: true,
      kickMembers: true,
      banMembers: true,
      mentionEveryone: false,
      highestRolePosition: 10,
    },
    fetchedAt: '2026-08-17T05:00:00.000Z',
  };

  it('Secret未設定時は503を返しGuild情報を取得しない', async () => {
    let called = false;
    const baseUrl = await startServer(async () => response('operational'), {
      getGuildOptions: async () => {
        called = true;
        return options;
      },
    });

    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/options`);
    expect(result.status).toBe(503);
    expect(called).toBe(false);
  });

  it('Bearer Secretが一致しない場合は401を返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      getGuildOptions: async () => options,
    });

    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/options`, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(result.status).toBe(401);
  });

  it('認証済みGETだけGuild optionsを返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      getGuildOptions: async (guildId) => (guildId === GUILD_ID ? options : null),
    });

    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/options`, {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(options);
  });
});

describe('internal guild members API', () => {
  const member = {
    id: '987654321098765432',
    username: 'herta-user',
    displayName: 'Herta User',
    avatarUrl: null,
    bot: false,
    roleIds: ['1069969919271252018'],
  };

  it('Secret未設定時は503を返しメンバー検索を実行しない', async () => {
    let called = false;
    const baseUrl = await startServer(async () => response('operational'), {
      searchGuildMembers: async () => {
        called = true;
        return [member];
      },
    });

    const result = await fetch(
      `${baseUrl}/internal/guilds/${GUILD_ID}/members?query=${member.id}&limit=1`,
    );
    expect(result.status).toBe(503);
    expect(called).toBe(false);
  });

  it('Bearer Secretが一致しない場合は401を返す', async () => {
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      searchGuildMembers: async () => [member],
    });

    const result = await fetch(
      `${baseUrl}/internal/guilds/${GUILD_ID}/members?query=${member.id}&limit=1`,
      { headers: { Authorization: 'Bearer wrong-secret' } },
    );
    expect(result.status).toBe(401);
  });

  it('認証済みGETでqueryとlimitを検証してメンバーを返す', async () => {
    let received: { guildId: string; query: string; limit: number } | null = null;
    const baseUrl = await startServer(async () => response('operational'), {
      internalApiSecret: INTERNAL_SECRET,
      searchGuildMembers: async (guildId, query, limit) => {
        received = { guildId, query, limit };
        return [member];
      },
    });

    const result = await fetch(
      `${baseUrl}/internal/guilds/${GUILD_ID}/members?query=${member.id}&limit=999`,
      { headers: { Authorization: `Bearer ${INTERNAL_SECRET}` } },
    );
    expect(result.status).toBe(200);
    expect(received).toEqual({ guildId: GUILD_ID, query: member.id, limit: 20 });
    expect(await result.json()).toEqual({ members: [member] });
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

  it('PATCH mutationはhealth timeoutを超えても完了まで待って成功を返す', async () => {
    let completed = false;
    const baseUrl = await startServer(
      async () => response('operational'),
      {
        internalApiSecret: INTERNAL_SECRET,
        updateGuildBotProfile: async (_guildId, input) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          completed = true;
          return { ...profile, nickname: input.nickname };
        },
      },
      { checkTimeoutMs: -4_990 },
    );

    const result = await fetch(`${baseUrl}/internal/guilds/${GUILD_ID}/bot-profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${INTERNAL_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: 'Slow Herta' }),
    });

    expect(result.status).toBe(200);
    expect(completed).toBe(true);
    expect(await result.json()).toEqual({ profile: { ...profile, nickname: 'Slow Herta' } });
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
