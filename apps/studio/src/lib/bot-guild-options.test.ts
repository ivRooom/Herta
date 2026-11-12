import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGuildConfigurationOptions,
  getGuildConfigurationOptionsCached,
  guildChannelOptionSchema,
} from './bot-guild-options.ts';

const GUILD_ID = '964326043420872704';
const INTERNAL_SECRET = '0123456789abcdef0123456789abcdef';

function restoreEnvironment(originalHealthUrl?: string, originalSecret?: string) {
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

test('Guild options取得時にBot内部API Bearer Secretを送信する', async (t) => {
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalHealthUrl, originalSecret));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  process.env['BOT_INTERNAL_API_SECRET'] = INTERNAL_SECRET;

  const result = await getGuildConfigurationOptions(GUILD_ID, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `/internal/guilds/${GUILD_ID}/options`);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${INTERNAL_SECRET}`);
    assert.equal(new Headers(init?.headers).get('accept'), 'application/json');

    return Response.json({
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
    });
  });

  assert.ok(result);
  assert.equal(result.guildId, GUILD_ID);
  assert.equal(result.guildName, 'Herta Test Guild');
});

test('Bot内部API Secret未設定時はGuild optionsを取得しない', async (t) => {
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalHealthUrl, originalSecret));

  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  delete process.env['BOT_INTERNAL_API_SECRET'];
  let called = false;

  const result = await getGuildConfigurationOptions(GUILD_ID, async () => {
    called = true;
    return Response.json({});
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test('不正なGuild IDは内部APIへ送らない', async () => {
  let called = false;
  const result = await getGuildConfigurationOptions('../other-guild', async () => {
    called = true;
    return Response.json({});
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

function validOptionsPayload(guildId: string) {
  return {
    guildId,
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
}

function stubGlobalFetch(t: { after: (fn: () => void) => void }, impl: typeof fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function prepareBotEnv(t: { after: (fn: () => void) => void }) {
  const originalHealthUrl = process.env['BOT_HEALTH_URL'];
  const originalSecret = process.env['BOT_INTERNAL_API_SECRET'];
  t.after(() => restoreEnvironment(originalHealthUrl, originalSecret));
  process.env['BOT_HEALTH_URL'] = 'http://bot:3000/healthz';
  process.env['BOT_INTERNAL_API_SECRET'] = INTERNAL_SECRET;
}

test('キャッシュ版はTTL内の再取得をBotへ送らない', async (t) => {
  prepareBotEnv(t);
  const guildId = '100000000000000001';
  let calls = 0;
  stubGlobalFetch(t, async () => {
    calls += 1;
    return Response.json(validOptionsPayload(guildId));
  });

  const first = await getGuildConfigurationOptionsCached(guildId);
  const second = await getGuildConfigurationOptionsCached(guildId);

  assert.equal(calls, 1);
  assert.ok(first);
  assert.equal(second, first);
});

test('キャッシュ版は同時リクエストを1回の取得へ合流させる', async (t) => {
  prepareBotEnv(t);
  const guildId = '100000000000000002';
  let calls = 0;
  stubGlobalFetch(t, async () => {
    calls += 1;
    return Response.json(validOptionsPayload(guildId));
  });

  const [first, second] = await Promise.all([
    getGuildConfigurationOptionsCached(guildId),
    getGuildConfigurationOptionsCached(guildId),
  ]);

  assert.equal(calls, 1);
  assert.ok(first);
  assert.equal(second, first);
});

test('キャッシュ版はTTLを過ぎたら再取得する', async (t) => {
  prepareBotEnv(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  t.after(() => t.mock.timers.reset());
  const guildId = '100000000000000004';
  let calls = 0;
  stubGlobalFetch(t, async () => {
    calls += 1;
    return Response.json(validOptionsPayload(guildId));
  });

  await getGuildConfigurationOptionsCached(guildId);
  t.mock.timers.tick(29_000);
  await getGuildConfigurationOptionsCached(guildId);
  assert.equal(calls, 1);

  t.mock.timers.tick(2_000);
  await getGuildConfigurationOptionsCached(guildId);
  assert.equal(calls, 2);
});

test('キャッシュ版は取得失敗をキャッシュせず次回再取得する', async (t) => {
  prepareBotEnv(t);
  const guildId = '100000000000000003';
  let calls = 0;
  stubGlobalFetch(t, async () => {
    calls += 1;
    if (calls === 1) return new Response('unavailable', { status: 503 });
    return Response.json(validOptionsPayload(guildId));
  });

  const first = await getGuildConfigurationOptionsCached(guildId);
  const second = await getGuildConfigurationOptionsCached(guildId);

  assert.equal(first, null);
  assert.ok(second);
  assert.equal(calls, 2);
});

test('channel schema preserves omitted permission defaults and rejects unsafe positions', () => {
  const channel = { id: '123', name: 'general', kind: 'text', position: 0, parentId: null };
  assert.deepEqual(guildChannelOptionSchema.parse(channel), {
    ...channel,
    viewable: false,
    readMessageHistory: false,
  });
  for (const position of [Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5]) {
    assert.equal(guildChannelOptionSchema.safeParse({ ...channel, position }).success, false);
  }
});
