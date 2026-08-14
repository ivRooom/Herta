import assert from 'node:assert/strict';
import test from 'node:test';
import { getGuildConsoleContext, getGuildConsoleHref } from './guild-context-nav.ts';

const GUILD_ID = '123456789012345678';

test('Guildコンソールの主要画面を判定する', () => {
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}`), {
    guildId: GUILD_ID,
    section: 'overview',
  });
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/plugins`), {
    guildId: GUILD_ID,
    section: 'plugins',
  });
  assert.deepEqual(
    getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/plugins/activity-rules`),
    {
      guildId: GUILD_ID,
      section: 'plugins',
    },
  );
  assert.deepEqual(getGuildConsoleContext(`/dashboard/guilds/${GUILD_ID}/audit-logs`), {
    guildId: GUILD_ID,
    section: 'audit-logs',
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
});

test('Guild一覧や不正なGuild IDではコンテキストを生成しない', () => {
  assert.equal(getGuildConsoleContext('/dashboard/guilds'), null);
  assert.equal(getGuildConsoleContext('/dashboard/guilds/not-a-guild/plugins'), null);
  assert.equal(getGuildConsoleContext('/dashboard/guilds/123/plugins'), null);
});

test('Guildコンソールの主要hrefを一元生成する', () => {
  assert.equal(getGuildConsoleHref(GUILD_ID, 'overview'), `/dashboard/guilds/${GUILD_ID}`);
  assert.equal(getGuildConsoleHref(GUILD_ID, 'plugins'), `/dashboard/guilds/${GUILD_ID}/plugins`);
  assert.equal(
    getGuildConsoleHref(GUILD_ID, 'audit-logs'),
    `/dashboard/guilds/${GUILD_ID}/audit-logs`,
  );
});
