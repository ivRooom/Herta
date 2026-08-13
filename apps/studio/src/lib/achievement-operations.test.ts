import assert from 'node:assert/strict';
import test from 'node:test';
import {
  achievementBlockRecordId,
  getAchievementCatalog,
  parseAchievementOperationRequest,
} from './achievement-operations.ts';

test('Achievement手動操作の入力を検証する', () => {
  assert.deepEqual(
    parseAchievementOperationRequest({
      action: 'grant',
      userId: '123456789012345678',
      achievementId: 'custom:chat-master:gold',
      reason: ' イベント補正 ',
    }),
    {
      action: 'grant',
      userId: '123456789012345678',
      achievementId: 'custom:chat-master:gold',
      reason: 'イベント補正',
    },
  );
  assert.equal(
    parseAchievementOperationRequest({
      action: 'delete',
      userId: '123456789012345678',
      achievementId: 'first-message',
    }),
    null,
  );
  assert.equal(
    parseAchievementOperationRequest({
      action: 'revoke',
      userId: '../user',
      achievementId: 'first-message',
    }),
    null,
  );
});

test('Built-inとCustom Achievementを同じCatalogへ統合する', () => {
  const catalog = getAchievementCatalog({
    customAchievements: [
      {
        key: 'chat-master',
        name: 'Chat Master',
        category: 'activity',
        enabled: true,
        stages: [
          {
            key: 'gold',
            name: 'Gold',
            emoji: '🥇',
            rarity: 'epic',
            points: 500,
          },
        ],
      },
    ],
  });
  assert.ok(catalog.some((item) => item.source === 'built-in'));
  assert.deepEqual(
    catalog.find((item) => item.id === 'custom:chat-master:gold'),
    {
      id: 'custom:chat-master:gold',
      name: 'Chat Master · Gold',
      emoji: '🥇',
      category: 'activity',
      rarity: 'epic',
      points: 500,
      source: 'custom',
    },
  );
});

test('取消抑止record IDを生成する', () => {
  assert.equal(achievementBlockRecordId('first-message'), 'blocked:first-message');
});
