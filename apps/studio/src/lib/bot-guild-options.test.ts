import assert from 'node:assert/strict';
import test from 'node:test';
import { getGuildConfigurationOptions } from './bot-guild-options.ts';

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
