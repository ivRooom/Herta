import assert from 'node:assert/strict';
import test from 'node:test';
import { searchGuildMembers } from './bot-guild-members.ts';

function restoreEnvironment(originalFetch: typeof globalThis.fetch, originalHealthUrl?: string) {
  globalThis.fetch = originalFetch;
  if (originalHealthUrl === undefined) {
    delete process.env['BOT_HEALTH_URL'];
  } else {
    process.env['BOT_HEALTH_URL'] = originalHealthUrl;
  }
}

test('Discord User IDの完全一致検索でもBot判定を保持する', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  t.after(() => restoreEnvironment(originalFetch, originalHealthUrl));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/internal/guilds/964326043420872704/members');
    assert.equal(url.searchParams.get('query'), '123456789012345678');
    assert.equal(url.searchParams.get('limit'), '1');

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

  const result = await searchGuildMembers(
    '964326043420872704',
    '123456789012345678',
    1,
  );

  assert.ok(result);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, '123456789012345678');
  assert.equal(result[0]?.bot, true);
});

test('短すぎる検索語はBot内部APIへ送信しない', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  t.after(() => restoreEnvironment(originalFetch, originalHealthUrl));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ members: [] });
  };

  const result = await searchGuildMembers('964326043420872704', 'a', 20);

  assert.deepEqual(result, []);
  assert.equal(called, false);
});
