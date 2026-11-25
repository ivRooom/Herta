import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  ACHIEVEMENT_CARD_PATH,
  ACHIEVEMENT_CARD_PURPOSE,
  buildAchievementCardRequest,
  fetchAchievementCardPng,
  resolveAchievementCardConfig,
  type AchievementCardConfig,
} from './achievement-card-ivrm.js';
import type { AchievementPayload } from './achievement-notifications.js';

const CONFIG: AchievementCardConfig = {
  apiBaseUrl: 'https://api.example.com',
  secret: 'test-secret',
};

const INPUT = {
  guildId: '964326043420872704',
  discordUserId: '123456789012345678',
  displayName: 'いゔる',
  payload: {
    code: 'total-xp-100',
    name: '最初の一歩',
    tier: 'master',
    xpReward: 100,
    unlockedAt: '2026-11-18T03:00:00.000Z',
  } satisfies AchievementPayload,
};

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-payload'),
]);

function createFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function okEnvelope(init?: RequestInit, overrides: Record<string, unknown> = {}): Response {
  const request = JSON.parse(String(init?.body)) as { requestId: string; discordUserId: string };
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      requestId: request.requestId,
      discordUserId: request.discordUserId,
      status: 'ok',
      card: { pngBase64: PNG_BYTES.toString('base64') },
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

test('config は quest-board と同じ env 名から解決し、不正な値は null', () => {
  assert.equal(resolveAchievementCardConfig({}), null);
  assert.equal(
    resolveAchievementCardConfig({ IVRM_WEB_API_BASE_URL: 'https://api.example.com' }),
    null,
  );
  assert.equal(resolveAchievementCardConfig({ HERTA_MBTI_SYNC_SECRET: 'secret' }), null);
  assert.equal(
    resolveAchievementCardConfig({
      IVRM_WEB_API_BASE_URL: 'http://api.example.com',
      HERTA_MBTI_SYNC_SECRET: 'secret',
    }),
    null,
  );
  assert.equal(
    resolveAchievementCardConfig({
      IVRM_WEB_API_BASE_URL: 'https://api.example.com/path',
      HERTA_MBTI_SYNC_SECRET: 'secret',
    }),
    null,
  );
  assert.deepEqual(
    resolveAchievementCardConfig({
      IVRM_WEB_API_BASE_URL: 'https://api.example.com/',
      HERTA_MBTI_SYNC_SECRET: 'secret',
    }),
    { apiBaseUrl: 'https://api.example.com', secret: 'secret' },
  );
});

test('リクエストは purpose で導出した鍵で署名され、本文に表示名と payload を載せる', () => {
  const request = buildAchievementCardRequest(CONFIG, INPUT, 'req-1', '2026-11-23T00:00:00.000Z');
  assert.equal(request.url, `https://api.example.com${ACHIEVEMENT_CARD_PATH}`);
  const body = JSON.parse(request.init.body) as Record<string, unknown>;
  assert.equal(body['schemaVersion'], 1);
  assert.equal(body['requestId'], 'req-1');
  assert.equal(body['guildId'], INPUT.guildId);
  assert.equal(body['discordUserId'], INPUT.discordUserId);
  assert.equal(body['displayName'], 'いゔる');
  assert.deepEqual(body['payload'], INPUT.payload);
  const key = createHmac('sha256', CONFIG.secret).update(ACHIEVEMENT_CARD_PURPOSE).digest();
  const expected = createHmac('sha256', key)
    .update(
      ['POST', ACHIEVEMENT_CARD_PATH, '2026-11-23T00:00:00.000Z', 'req-1', request.init.body].join(
        '\n',
      ),
    )
    .digest('hex');
  assert.equal(request.init.headers['X-IVRM-Signature'], expected);
  assert.equal(request.init.headers['X-IVRM-Event-Id'], 'req-1');
  assert.equal(request.init.headers['X-IVRM-Timestamp'], '2026-11-23T00:00:00.000Z');
});

test('payload の rank はカード生成リクエストにも載る (#1005)', () => {
  const withRank = buildAchievementCardRequest(
    CONFIG,
    {
      ...INPUT,
      payload: { ...INPUT.payload, rank: 'legend' },
    },
    'req-2',
    '2026-11-25T00:00:00.000Z',
  );
  const body = JSON.parse(withRank.init.body) as { payload: Record<string, unknown> };
  assert.deepEqual(body.payload, { ...INPUT.payload, rank: 'legend' });

  // rank の無い旧 payload では従来どおり rank キー自体を送らない。
  const withoutRank = buildAchievementCardRequest(
    CONFIG,
    INPUT,
    'req-3',
    '2026-11-25T00:00:00.000Z',
  );
  const legacyBody = JSON.parse(withoutRank.init.body) as {
    payload: Record<string, unknown>;
  };
  assert.deepEqual(legacyBody.payload, INPUT.payload);
  assert.equal('rank' in legacyBody.payload, false);
});

test('正常な envelope から PNG バイト列を返す', async () => {
  const { fetchImpl } = createFetch((_url, init) => okEnvelope(init));
  const png = await fetchAchievementCardPng(INPUT, CONFIG, fetchImpl);
  assert.ok(png);
  assert.deepEqual(png, PNG_BYTES);
});

test('生の image/png 応答も受け付ける', async () => {
  const { fetchImpl } = createFetch(
    () =>
      new Response(new Uint8Array(PNG_BYTES), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
  );
  const png = await fetchAchievementCardPng(INPUT, CONFIG, fetchImpl);
  assert.ok(png);
  assert.deepEqual(png, PNG_BYTES);
});

test('非 PNG の base64 は null', async () => {
  const { fetchImpl } = createFetch((_url, init) =>
    okEnvelope(init, { card: { pngBase64: Buffer.from('not-a-png').toString('base64') } }),
  );
  assert.equal(await fetchAchievementCardPng(INPUT, CONFIG, fetchImpl), null);
});

test('requestId が一致しない envelope は null', async () => {
  const { fetchImpl } = createFetch((_url, init) => okEnvelope(init, { requestId: 'other' }));
  assert.equal(await fetchAchievementCardPng(INPUT, CONFIG, fetchImpl), null);
});

test('HTTP エラーと JSON でない応答は null', async () => {
  const failing = createFetch(() => new Response('{}', { status: 500 }));
  assert.equal(await fetchAchievementCardPng(INPUT, CONFIG, failing.fetchImpl), null);
  const garbage = createFetch(
    () =>
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal(await fetchAchievementCardPng(INPUT, CONFIG, garbage.fetchImpl), null);
});

test('10MiB を超える PNG は null', async () => {
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 8);
  PNG_BYTES.copy(oversized, 0, 0, 8);
  const { fetchImpl } = createFetch((_url, init) =>
    okEnvelope(init, { card: { pngBase64: oversized.toString('base64') } }),
  );
  assert.equal(await fetchAchievementCardPng(INPUT, CONFIG, fetchImpl), null);
});

test('config が null なら fetch せず null、ID 形式が不正でも null', async () => {
  const { fetchImpl, calls } = createFetch(() => okEnvelope());
  assert.equal(await fetchAchievementCardPng(INPUT, null, fetchImpl), null);
  assert.equal(calls.length, 0);
  assert.equal(
    await fetchAchievementCardPng({ ...INPUT, guildId: 'guild-1' }, CONFIG, fetchImpl),
    null,
  );
  assert.equal(calls.length, 0);
});
