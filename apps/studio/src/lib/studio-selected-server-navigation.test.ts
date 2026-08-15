import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelectedServerNavigationItems } from './studio-selected-server-navigation.ts';

const GUILD_ID = '123456789012345678';

test('選択中サーバーの主要管理画面を直接リンクする', () => {
  const items = buildSelectedServerNavigationItems(GUILD_ID);

  assert.deepEqual(
    items.map((item) => [item.id, item.href]),
    [
      ['selected-server-overview', `/dashboard/guilds/${GUILD_ID}`],
      ['selected-server-plugins', `/dashboard/guilds/${GUILD_ID}/plugins`],
      ['selected-server-leaderboard', `/dashboard/guilds/${GUILD_ID}/leaderboard`],
      ['selected-server-moderation', `/dashboard/guilds/${GUILD_ID}/moderation`],
      ['selected-server-audit-logs', `/dashboard/guilds/${GUILD_ID}/audit-logs`],
      ['selected-server-bot-profile', `/dashboard/guilds/${GUILD_ID}/bot-profile`],
    ],
  );
});

test('不正または未選択のGuildではサーバー固有リンクを作らない', () => {
  assert.deepEqual(buildSelectedServerNavigationItems(null), []);
  assert.deepEqual(buildSelectedServerNavigationItems('not-a-guild'), []);
});
