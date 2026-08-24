import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGuildConsoleContext,
  getGuildConsoleHref,
  getGuildSwitchHref,
} from './guild-context-nav.ts';

const GUILD_ID = '123456789012345678';
const OTHER_GUILD_ID = '987654321098765432';

test('Guildコンソールの主要画面を判定する', () => {
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}`), {
    guildId: GUILD_ID,
    section: 'overview',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/plugins`), {
    guildId: GUILD_ID,
    section: 'plugins',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/plugins/activity-rules`), {
    guildId: GUILD_ID,
    section: 'plugins',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/commands`), {
    guildId: GUILD_ID,
    section: 'commands',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/leaderboard`), {
    guildId: GUILD_ID,
    section: 'leaderboard',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/moderation`), {
    guildId: GUILD_ID,
    section: 'moderation',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/moderation/detections`), {
    guildId: GUILD_ID,
    section: 'moderation',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/audit-logs`), {
    guildId: GUILD_ID,
    section: 'audit-logs',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/access/policies`), {
    guildId: GUILD_ID,
    section: 'access',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/bot-profile`), {
    guildId: GUILD_ID,
    section: 'bot-profile',
  });
});

test('Guild配下の専用管理画面はotherとして現在Guildだけ維持する', () => {
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/birthday`), {
    guildId: GUILD_ID,
    section: 'other',
  });
  assert.deepEqual(
    getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/activity-rules/diagnostics`),
    {
      guildId: GUILD_ID,
      section: 'other',
    },
  );
});

test('主要画面に似た別パスを誤ってactive扱いしない', () => {
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/plugins-extra`), {
    guildId: GUILD_ID,
    section: 'other',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/audit-logs-archive`), {
    guildId: GUILD_ID,
    section: 'other',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/moderation-extra`), {
    guildId: GUILD_ID,
    section: 'other',
  });
});

test('Guild一覧や不正なGuild IDではコンテキストを生成しない', () => {
  assert.equal(getGuildConsoleContext('/dashboard/guilds'), null);
  assert.equal(getGuildConsoleContext('/dashboard/guilds/not-a-guild/plugins'), null);
  assert.equal(getGuildConsoleContext('/dashboard/guilds/123/plugins'), null);
});

test('Guildコンソールの主要hrefを一元生成する', () => {
  assert.equal(getGuildConsoleHref(GUILD_ID, 'overview'), `/dashboard/guilds/${GUILD_ID}`);
  assert.equal(getGuildConsoleHref(GUILD_ID, 'plugins'), `/dashboard/guilds/${GUILD_ID}/plugins`);
  assert.equal(getGuildConsoleHref(GUILD_ID, 'commands'), `/dashboard/guilds/${GUILD_ID}/commands`);
  assert.equal(
    getGuildConsoleHref(GUILD_ID, 'leaderboard'),
    `/dashboard/guilds/${GUILD_ID}/leaderboard`,
  );
  assert.equal(
    getGuildConsoleHref(GUILD_ID, 'moderation'),
    `/dashboard/guilds/${GUILD_ID}/moderation`,
  );
  assert.equal(
    getGuildConsoleHref(GUILD_ID, 'audit-logs'),
    `/dashboard/guilds/${GUILD_ID}/audit-logs`,
  );
  assert.equal(getGuildConsoleHref(GUILD_ID, 'access'), `/dashboard/guilds/${GUILD_ID}/access`);
  assert.equal(
    getGuildConsoleHref(GUILD_ID, 'bot-profile'),
    `/dashboard/guilds/${GUILD_ID}/bot-profile`,
  );
});

test('Guild切替では主要セクションを安全に維持する', () => {
  for (const section of [
    'plugins',
    'commands',
    'leaderboard',
    'moderation',
    'audit-logs',
    'access',
    'bot-profile',
  ] as const) {
    assert.equal(
      getGuildSwitchHref(OTHER_GUILD_ID, { guildId: GUILD_ID, section }),
      `/dashboard/guilds/${OTHER_GUILD_ID}/${section}`,
    );
  }
});

test('overview切替は新Guild概要を維持する', () => {
  assert.equal(
    getGuildSwitchHref(OTHER_GUILD_ID, { guildId: GUILD_ID, section: 'overview' }),
    `/dashboard/guilds/${OTHER_GUILD_ID}`,
  );
});

test('専用管理画面やGuild外からの切替は新Guild概要へ戻す', () => {
  assert.equal(
    getGuildSwitchHref(OTHER_GUILD_ID, { guildId: GUILD_ID, section: 'other' }),
    `/dashboard/guilds/${OTHER_GUILD_ID}`,
  );
  assert.equal(getGuildSwitchHref(OTHER_GUILD_ID, null), `/dashboard/guilds/${OTHER_GUILD_ID}`);
});
