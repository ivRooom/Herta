import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioCurrentServerToolGroups } from './studio-current-server-tools.ts';
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

test('Moderationは詳細画面でも親ナビゲーションをactiveにできる', () => {
  const moderation = buildSelectedServerNavigationItems(GUILD_ID).find(
    (item) => item.id === 'selected-server-moderation',
  );

  assert.ok(moderation);
  assert.notEqual(moderation.exact, true);
});

test('不正または未選択のGuildではサーバー固有リンクを作らない', () => {
  assert.deepEqual(buildSelectedServerNavigationItems(null), []);
  assert.deepEqual(buildSelectedServerNavigationItems('not-a-guild'), []);
});

test('Current Serverの詳細ツールをCommunityとModerationへ分類する', () => {
  const groups = buildStudioCurrentServerToolGroups(GUILD_ID, 'Test Guild');

  assert.deepEqual(
    groups.map((group) => group.id),
    ['community', 'moderation'],
  );

  const community = groups.find((group) => group.id === 'community');
  const moderation = groups.find((group) => group.id === 'moderation');

  assert.ok(community?.items.some((item) => item.id === 'guild-auto-response'));
  assert.ok(community?.items.some((item) => item.id === 'guild-birthday'));
  assert.ok(community?.items.some((item) => item.id === 'guild-xp-operations'));
  assert.ok(
    community?.items.some(
      (item) => item.href === `/dashboard/guilds/${GUILD_ID}/plugins/quote/quotes`,
    ),
  );
  assert.ok(moderation?.items.some((item) => item.id === 'guild-moderation-detections'));
  assert.ok(moderation?.items.some((item) => item.id === 'guild-moderation-blacklist'));
  assert.ok(moderation?.items.some((item) => item.id === 'guild-moderation-enforcement'));
});

test('主要リンクと重複するLeaderboardとModerationトップは詳細ツールから除外する', () => {
  const groups = buildStudioCurrentServerToolGroups(GUILD_ID, 'Test Guild');
  const itemIds = groups.flatMap((group) => group.items.map((item) => item.id));

  assert.ok(!itemIds.includes('guild-leaderboard'));
  assert.ok(!itemIds.includes('guild-moderation'));
});

test('不正または未選択のGuildでは詳細ツールグループも作らない', () => {
  assert.deepEqual(buildStudioCurrentServerToolGroups(null, null), []);
  assert.deepEqual(buildStudioCurrentServerToolGroups('not-a-guild', 'Invalid Guild'), []);
});
