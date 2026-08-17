import assert from 'node:assert/strict';
import test from 'node:test';
import { searchGuildMembers } from './bot-guild-members.ts';

const INTERNAL_SECRET = '0123456789abcdef0123456789abcdef';

function restoreEnvironment(
  originalFetch: typeof globalThis.fetch,
  originalHealthUrl?: string,
  originalSecret?: string,
) {
  globalThis.fetch = originalFetch;
  if (originalHealthUrl === undefined) {
    delete process.env['BOT_HEALTH_URL'];
  } else {
    process.env['BOT_HEALTH_URL'] = originalHealthUrl;
  }
  if (originalSecret === undefined) {
    delete process.env['BOT_INTERNAL_API_SECRET'];
  } else {
    process.env['BOT_INTERNAL_API_SECRET'] = originalSecret;
  }
}

test('Discord User IDの完全一致検索でもBot判定と内部API認証を保持する', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalFetch, originalHealthUrl, originalSecret));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  process.env['BOT_INTERNAL_API_SECRET'] = INTERNAL_SECRET;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/internal/guilds/964326043420872704/members');
    assert.equal(url.searchParams.get('query'), '123456789012345678');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${INTERNAL_SECRET}`);

    return Response.json({
      members: [
        {
          id: '123456789012345678',
          username: 'herta-helper',
          displayName: 'Herta Helper',
          avatarUrl: null,
          bot: true,
        },
      ],
    });
  };

  const result = await searchGuildMembers('964326043420872704', '123456789012345678', 1);

  assert.ok(result);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, '123456789012345678');
  assert.equal(result[0]?.username, 'herta-helper');
  assert.equal(result[0]?.displayName, 'Herta Helper');
  assert.equal(result[0]?.avatarUrl, null);
  assert.equal(result[0]?.bot, true);
});

test('短すぎる検索語はBot内部APIへ送信しない', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalFetch, originalHealthUrl, originalSecret));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  process.env['BOT_INTERNAL_API_SECRET'] = INTERNAL_SECRET;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ members: [] });
  };

  const result = await searchGuildMembers('964326043420872704', 'a', 20);

  assert.deepEqual(result, []);
  assert.equal(called, false);
});

test('内部API Secret未設定時はfail closedでリクエストしない', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalFetch, originalHealthUrl, originalSecret));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  delete process.env['BOT_INTERNAL_API_SECRET'];
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ members: [] });
  };

  const result = await searchGuildMembers('964326043420872704', 'herta', 20);

  assert.equal(result, null);
  assert.equal(called, false);
});
