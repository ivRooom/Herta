import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBotHealth,
  parseBotHealthResponse,
  resolveBotHealthRequestTimeoutMs,
} from './bot-health.ts';

const validHealth = {
  service: {
    id: 'herta-discord-bot',
    name: 'Herta',
    type: 'discord_bot',
  },
  status: 'operational',
  checked_at: '2026-07-26T13:00:00.000Z',
  uptime_seconds: 3600,
  version: '0.1.0',
  checks: {
    process: { status: 'ok' },
    discord: {
      status: 'ok',
      connected: true,
      ready: true,
      gateway_status: 'ready',
      reconnecting: false,
      last_ready_at: '2026-07-26T12:00:00.000Z',
      last_heartbeat_at: '2026-07-26T12:59:30.000Z',
      last_disconnect_at: null,
      heartbeat_source: 'gateway_status_observation',
    },
    database: { status: 'ok', latency_ms: 12 },
    redis: { status: 'ok', latency_ms: 3 },
    worker: {
      status: 'ok',
      latency_ms: 2,
      last_heartbeat_at: '2026-07-26T12:59:50.000Z',
    },
  },
};

function restoreHealthEnvironment(
  originalFetch: typeof globalThis.fetch,
  originalHealthUrl?: string,
) {
  globalThis.fetch = originalFetch;
  if (originalHealthUrl === undefined) {
    delete process.env['BOT_HEALTH_URL'];
  } else {
    process.env['BOT_HEALTH_URL'] = originalHealthUrl;
  }
}

test('Botヘルスの正常レスポンスを受け入れる', () => {
  const parsed = parseBotHealthResponse(validHealth);

  assert.ok(parsed);
  assert.equal(parsed.status, 'operational');
  assert.equal(parsed.checks.discord.gateway_status, 'ready');
  assert.equal(parsed.checks.database.latency_ms, 12);
});

test('必須フィールドが不足したレスポンスを拒否する', () => {
  const parsed = parseBotHealthResponse({
    ...validHealth,
    checks: {
      ...validHealth.checks,
      discord: { status: 'ok' },
    },
  });

  assert.equal(parsed, null);
});

test('障害状態の503レスポンス形式も受け入れる', () => {
  const parsed = parseBotHealthResponse({
    ...validHealth,
    status: 'outage',
    checks: {
      ...validHealth.checks,
      discord: {
        ...validHealth.checks.discord,
        status: 'error',
        connected: false,
        ready: false,
        gateway_status: 'disconnected',
        message: 'dependency check failed',
      },
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.status, 'outage');
  assert.equal(parsed.checks.discord.status, 'error');
});

test('Bot側のチェック待機時間へ余裕を加えた取得タイムアウトを使う', () => {
  assert.equal(resolveBotHealthRequestTimeoutMs(undefined, '5000'), 6000);
  assert.equal(resolveBotHealthRequestTimeoutMs(undefined, '3000'), 4000);
});

test('Studio側の明示タイムアウトを優先する', () => {
  assert.equal(resolveBotHealthRequestTimeoutMs('8000', '5000'), 8000);
});

test('JSONではない応答を不正なレスポンスとして分類する', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  t.after(() => restoreHealthEnvironment(originalFetch, originalHealthUrl));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  globalThis.fetch = async () =>
    new Response('<!doctype html><title>Bad Gateway</title>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });

  const result = await getBotHealth();

  assert.equal(result.available, false);
  if (result.available) assert.fail('不正なレスポンスが利用可能として扱われました');
  assert.equal(result.reason, 'invalid_response');
});

test('接続失敗を到達不能として分類する', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  t.after(() => restoreHealthEnvironment(originalFetch, originalHealthUrl));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const result = await getBotHealth();

  assert.equal(result.available, false);
  if (result.available) assert.fail('接続失敗が利用可能として扱われました');
  assert.equal(result.reason, 'unreachable');
});
