import { describe, expect, it } from 'vitest';
import {
  customAchievementUnlockId,
  normalizeCustomAchievementSeries,
  unlockedCustomAchievementIds,
  type CustomAchievementMetrics,
} from './custom-achievements.js';

const metrics: CustomAchievementMetrics = {
  xp: 1500,
  messages: 120,
  reactionsGiven: 20,
  reactionsReceived: 10,
  voiceSeconds: 3600,
  minecraftSeconds: 0,
  pollVotes: 2,
  giveawayEntries: 1,
  eventGoing: 3,
  suggestions: 1,
  acceptedSuggestions: 0,
  challengeCompletions: 2,
  seasonPoints: 50,
};

describe('custom achievements', () => {
  it('段階アチーブメントを正規化して安定したIDを生成する', () => {
    const series = normalizeCustomAchievementSeries([
      {
        key: 'chat-master',
        name: 'Chat Master',
        category: 'activity',
        stages: [
          {
            key: 'bronze',
            name: 'Bronze',
            conditions: [{ metric: 'messages', target: 100 }],
          },
        ],
      },
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]?.key).toBe('chat-master');
    expect(customAchievementUnlockId('chat-master', 'bronze')).toBe(
      'custom:chat-master:bronze',
    );
  });

  it('ALL / ANY 条件で解除を判定する', () => {
    const series = normalizeCustomAchievementSeries([
      {
        key: 'activity',
        name: 'Activity',
        stages: [
          {
            key: 'all',
            name: 'ALL',
            conditionMode: 'all',
            conditions: [
              { metric: 'messages', target: 100 },
              { metric: 'voiceSeconds', target: 3600 },
            ],
          },
          {
            key: 'any',
            name: 'ANY',
            conditionMode: 'any',
            conditions: [
              { metric: 'acceptedSuggestions', target: 1 },
              { metric: 'eventGoing', target: 3 },
            ],
          },
          {
            key: 'locked',
            name: 'Locked',
            conditions: [{ metric: 'xp', target: 9999 }],
          },
        ],
      },
    ]);

    expect(unlockedCustomAchievementIds(series, metrics)).toEqual([
      'custom:activity:all',
      'custom:activity:any',
    ]);
  });

  it('不正・重複定義を除外しDiscord IDを安全に正規化する', () => {
    const series = normalizeCustomAchievementSeries([
      {
        key: 'series',
        name: 'Series',
        stages: [
          {
            key: 'gold',
            name: 'Gold',
            rewardRoleId: '123456789012345678',
            notificationChannelId: 'invalid',
            conditions: [{ metric: 'xp', target: 1000 }],
          },
          {
            key: 'gold',
            name: 'Duplicate',
            conditions: [{ metric: 'messages', target: 1 }],
          },
          {
            key: 'invalid stage!',
            conditions: [{ metric: 'messages', target: 1 }],
          },
        ],
      },
    ]);

    expect(series[0]?.stages).toHaveLength(1);
    expect(series[0]?.stages[0]?.rewardRoleId).toBe('123456789012345678');
    expect(series[0]?.stages[0]?.notificationChannelId).toBeNull();
  });
});
