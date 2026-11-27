import { createLogger } from '@herta/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManualBirthdayDeliveryResult } from '../plugins/birthday-role.js';
import type { HealthConfig } from './config.js';
import { HealthHttpServer, type HealthHttpServerOptions } from './server.js';
import type { HertaHealthResponse } from './types.js';

const logger = createLogger({ name: 'health-http-manual-birthday-test', level: 'silent' });
const servers: HealthHttpServer[] = [];
const INTERNAL_SECRET = '0123456789abcdef0123456789abcdef';
const GUILD_ID = '111111111111111111';
const USER_ID = '222222222222222222';

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

function healthResponse(): HertaHealthResponse {
  return {
    service: { id: 'herta-discord-bot', name: 'Herta', type: 'discord_bot' },
    status: 'operational',
    checked_at: '2026-11-22T01:00:00.000Z',
    uptime_seconds: 100,
    version: '1.0.0',
    guild_count: 3,
    checks: {
      process: { status: 'ok' },
      discord: {
        status: 'ok',
        connected: true,
        ready: true,
        gateway_status: 'ready',
        reconnecting: false,
        last_ready_at: '2026-11-22T00:00:00.000Z',
        last_heartbeat_at: '2026-11-22T00:59:00.000Z',
        last_disconnect_at: null,
        heartbeat_source: 'gateway_status_observation',
      },
      database: { status: 'ok' },
      redis: { status: 'ok' },
      worker: { status: 'ok' },
    },
  };
}

type ExtraOptions = Pick<
  HealthHttpServerOptions,
  'internalApiSecret' | 'runManualBirthdayDelivery'
>;

async function startServer(extraOptions: ExtraOptions = {}) {
  const server = new HealthHttpServer({
    config: config(),
    logger,
    version: '1.0.0',
    getHealth: async () => healthResponse(),
    now: () => new Date('2026-11-22T01:00:00.000Z'),
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

const PATH = `/internal/guilds/${GUILD_ID}/birthday/manual-delivery`;

function post(baseUrl: string, body: unknown, secret?: string) {
  return fetch(`${baseUrl}${PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === undefined ? {} : { Authorization: `Bearer ${secret}` }),
    },
    body: JSON.stringify(body),
  });
}

describe('internal birthday manual delivery API (#1062)', () => {
  it('Secret未設定時は503を返し実行しない', async () => {
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => ({
      status: 'ok',
      reason: null,
      deliveries: [],
    }));
    const baseUrl = await startServer({ runManualBirthdayDelivery: run });
    const result = await post(
      baseUrl,
      { discordUserId: USER_ID, localDate: '2026-11-22' },
      INTERNAL_SECRET,
    );
    expect(result.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it('Bearer <redacted>が一致しない場合は401を返す', async () => {
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => ({
      status: 'ok',
      reason: null,
      deliveries: [],
    }));
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: run,
    });
    const result = await post(
      baseUrl,
      { discordUserId: USER_ID, localDate: '2026-11-22' },
      'wrong',
    );
    expect(result.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('認証済みPOSTで検証済み入力だけを実行関数へ渡し、結果をそのまま返す', async () => {
    const expected: ManualBirthdayDeliveryResult = {
      status: 'ok',
      reason: null,
      deliveries: [
        { category: 'role_assign', outcome: 'delivered', reason: null },
        { category: 'card', outcome: 'already_delivered', reason: null },
      ],
    };
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => expected);
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: run,
    });
    const result = await post(
      baseUrl,
      { discordUserId: USER_ID, localDate: '2026-11-22' },
      INTERNAL_SECRET,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ result: expected });
    expect(run).toHaveBeenCalledWith(GUILD_ID, {
      discordUserId: USER_ID,
      localDate: '2026-11-22',
    });
  });

  it('拒否理由も結果として200で返す（理由コードは呼び出し側の写像に委ねる）', async () => {
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => ({
      status: 'rejected',
      reason: 'date_out_of_range',
      deliveries: [],
    }));
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: run,
    });
    const result = await post(
      baseUrl,
      { discordUserId: USER_ID, localDate: '2020-01-01' },
      INTERNAL_SECRET,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      result: { status: 'rejected', reason: 'date_out_of_range', deliveries: [] },
    });
  });

  it('不正なbodyは400を返し実行しない', async () => {
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => ({
      status: 'ok',
      reason: null,
      deliveries: [],
    }));
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: run,
    });
    const result = await post(
      baseUrl,
      { discordUserId: 'not-an-id', localDate: '2026-11-22' },
      INTERNAL_SECRET,
    );
    expect(result.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('実行関数が例外を投げたら503を返す', async () => {
    const run = vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => {
      throw new Error('boom');
    });
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: run,
    });
    const result = await post(
      baseUrl,
      { discordUserId: USER_ID, localDate: '2026-11-22' },
      INTERNAL_SECRET,
    );
    expect(result.status).toBe(503);
    expect(((await result.json()) as { status: string }).status).toBe('unavailable');
  });

  it('GETは405を返す', async () => {
    const baseUrl = await startServer({
      internalApiSecret: INTERNAL_SECRET,
      runManualBirthdayDelivery: vi.fn(async (): Promise<ManualBirthdayDeliveryResult> => ({
        status: 'ok',
        reason: null,
        deliveries: [],
      })),
    });
    const result = await fetch(`${baseUrl}${PATH}`, {
      headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(result.status).toBe(405);
  });
});
