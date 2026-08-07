import assert from 'node:assert/strict';
import test from 'node:test';
import { DiscordApiError, fetchUserGuilds } from './discord.ts';

const guilds = [
  {
    id: '100',
    name: 'Test Guild',
    icon: null,
    owner: true,
    permissions: '8',
    features: [],
  },
];

test('Guild一覧を正常に取得する', async () => {
  const { fetchImpl, calls } = sequenceFetch([jsonResponse(guilds)]);

  const result = await fetchUserGuilds('test-token', { fetchImpl });

  assert.deepEqual(result, guilds);
  assert.equal(calls(), 1);
});

test('短い429はRetry-Afterを待って1回だけ再試行する', async () => {
  const { fetchImpl, calls } = sequenceFetch([
    jsonResponse({ retry_after: 0.05 }, 429),
    jsonResponse(guilds),
  ]);
  const sleeps: number[] = [];

  const result = await fetchUserGuilds('test-token', {
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(result, guilds);
  assert.deepEqual(sleeps, [50]);
  assert.equal(calls(), 2);
});

test('長い429は待機せずRetry-After付きエラーを返す', async () => {
  const { fetchImpl, calls } = sequenceFetch([jsonResponse({ retry_after: 3 }, 429)]);
  const sleeps: number[] = [];

  await assert.rejects(
    fetchUserGuilds('test-token', {
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 3_000);
      return true;
    },
  );

  assert.deepEqual(sleeps, []);
  assert.equal(calls(), 1);
});

test('再試行後も429ならそれ以上再試行しない', async () => {
  const { fetchImpl, calls } = sequenceFetch([
    jsonResponse({ retry_after: 0.01 }, 429),
    jsonResponse({ retry_after: 0.2 }, 429),
  ]);
  const sleeps: number[] = [];

  await assert.rejects(
    fetchUserGuilds('test-token', {
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 200);
      return true;
    },
  );

  assert.deepEqual(sleeps, [10]);
  assert.equal(calls(), 2);
});

test('401は再試行せず型付きエラーを返す', async () => {
  const { fetchImpl, calls } = sequenceFetch([jsonResponse({ message: 'Unauthorized' }, 401)]);

  await assert.rejects(fetchUserGuilds('test-token', { fetchImpl }), (error: unknown) => {
    assert.ok(error instanceof DiscordApiError);
    assert.equal(error.status, 401);
    assert.equal(error.retryAfterMs, null);
    return true;
  });

  assert.equal(calls(), 1);
});

test('Discord 5xxは再試行せず型付きエラーを返す', async () => {
  const { fetchImpl, calls } = sequenceFetch([jsonResponse({ message: 'Unavailable' }, 503)]);

  await assert.rejects(fetchUserGuilds('test-token', { fetchImpl }), (error: unknown) => {
    assert.ok(error instanceof DiscordApiError);
    assert.equal(error.status, 503);
    assert.equal(error.retryAfterMs, null);
    return true;
  });

  assert.equal(calls(), 1);
});

function sequenceFetch(responses: Response[]) {
  let callCount = 0;
  const fetchImpl = (async () => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) throw new Error('想定より多くfetchが呼ばれました');
    return response;
  }) as typeof fetch;

  return {
    fetchImpl,
    calls: () => callCount,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
