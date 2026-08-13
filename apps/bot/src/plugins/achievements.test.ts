import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  achievementPoints,
  achievementScoreForIds,
  formatAchievementLeaderboard,
  formatAchievements,
  normalizeAchievementsConfig,
  unlockedAchievementIds,
  unlockedAchievementIdsWithCustom,
} from './achievements.js';
import type {
  AchievementLeaderboardRecord,
  AchievementMetrics,
  AchievementUnlockRecord,
} from './achievements-repository.js';

const emptyMetrics: AchievementMetrics = {
  xp: 0,
  messages: 0,
  reactionsGiven: 0,
  reactionsReceived: 0,
  voiceSeconds: 0,
  minecraftSeconds: 0,
  pollVotes: 0,
  giveawayEntries: 0,
  eventGoing: 0,
  suggestions: 0,
  acceptedSuggestions: 0,
  challengeCompletions: 0,
  seasonPoints: 0,
  minigamePlays: 0,
  minigameWins: 0,
  coinflipWins: 0,
  highLowBestStreak: 0,
  highLowClears: 0,
  blackjackWins: 0,
  blackjackNaturals: 0,
};

describe('Achievements v3', () => {
  it('既存v2設定を安全な範囲へ正規化しCustom Achievementを空配列で補完する', () => {
    expect(
      normalizeAchievementsConfig({
        pageSize: 99,
        leaderboardSize: 100,
        autoSyncCooldownSeconds: 1,
        showLocked: false,
        notificationMinimumRarity: 'invalid',
        unlockChannelId: 'bad',
      }),
    ).toEqual({
      enabled: true,
      autoSync: true,
      autoSyncCooldownSeconds: 10,
      ephemeralSync: true,
      notifyUnlocks: true,
      unlockChannelId: null,
      mentionOnUnlock: false,
      notificationMinimumRarity: 'common',
      customAchievements: [],
      showLocked: false,
      showProgress: true,
      showScore: true,
      showRarity: true,
      hideSecretUntilUnlocked: true,
      pageSize: 20,
      leaderboardSize: 25,
    });
  });

  it('既存Achievement IDを維持しつつActivity系Achievementを追加する', () => {
    const ids = new Set(ACHIEVEMENTS.map((achievement) => achievement.id));
    for (const id of [
      'first-steps',
      'getting-active',
      'server-regular',
      'veteran',
      'first-vote',
      'voice-of-community',
      'feeling-lucky',
      'event-goer',
      'community-regular',
      'idea-maker',
      'change-maker',
      'community-legend',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has('first-message')).toBe(true);
    expect(ids.has('voice-veteran')).toBe(true);
    expect(ids.has('reaction-machine')).toBe(true);
    expect(ids.has('all-rounder')).toBe(true);
    expect(ids.has('xp-elite')).toBe(true);
    expect(ids.has('chat-marathon')).toBe(true);
    expect(ids.has('community-builder')).toBe(true);
    expect(ids.has('minecraft-explorer')).toBe(true);
    expect(ids.has('minecraft-regular')).toBe(true);
    expect(ids.has('minecraft-veteran')).toBe(true);
    expect(ids.has('first-challenge')).toBe(true);
    expect(ids.has('challenge-master')).toBe(true);
    expect(ids.has('season-legend')).toBe(true);
    expect(ACHIEVEMENTS).toHaveLength(54);
  });

  it('Activity Rules集計後の発言・リアクション・VCから実績を解除する', () => {
    const unlocked = unlockedAchievementIds({
      ...emptyMetrics,
      messages: 1200,
      reactionsGiven: 1000,
      reactionsReceived: 120,
      voiceSeconds: 40_000,
    });
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'first-message',
        'chat-starter',
        'conversation-engine',
        'first-reaction',
        'reaction-regular',
        'reaction-machine',
        'noticed',
        'crowd-favorite',
        'voice-check-in',
        'voice-regular',
      ]),
    );
    expect(unlocked).not.toContain('chat-legend');
    expect(unlocked).not.toContain('voice-veteran');
  });

  it('既存Pluginメトリクスから複数のAchievementを解除する', () => {
    const unlocked = unlockedAchievementIds({
      ...emptyMetrics,
      xp: 5200,
      pollVotes: 10,
      giveawayEntries: 1,
      eventGoing: 3,
      suggestions: 1,
      acceptedSuggestions: 1,
    });
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'first-steps',
        'getting-active',
        'server-regular',
        'first-vote',
        'voice-of-community',
        'feeling-lucky',
        'event-goer',
        'idea-maker',
        'change-maker',
      ]),
    );
    expect(unlocked).not.toContain('community-legend');
  });

  it('Minecraft活動時間から3段階のAchievementを解除する', () => {
    const unlocked = unlockedAchievementIds({
      ...emptyMetrics,
      minecraftSeconds: 360_000,
    });
    expect(unlocked).toEqual(
      expect.arrayContaining(['minecraft-explorer', 'minecraft-regular', 'minecraft-veteran']),
    );
  });

  it('Challenge Clear数とSeason PointからAchievementを解除する', () => {
    const unlocked = unlockedAchievementIds({
      ...emptyMetrics,
      challengeCompletions: 100,
      seasonPoints: 1_500,
    });
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'first-challenge',
        'challenge-regular',
        'challenge-master',
        'season-rising',
        'season-legend',
      ]),
    );
  });

  it('All-Rounderは4分野を満たした時だけ解除する', () => {
    expect(
      unlockedAchievementIds({
        ...emptyMetrics,
        messages: 500,
        voiceSeconds: 18_000,
        reactionsGiven: 100,
        reactionsReceived: 50,
      }),
    ).toContain('all-rounder');
    expect(
      unlockedAchievementIds({
        ...emptyMetrics,
        messages: 500,
        voiceSeconds: 18_000,
        reactionsGiven: 100,
        reactionsReceived: 49,
      }),
    ).not.toContain('all-rounder');
  });

  it('Secret Achievementはv1と同じ複合条件を満たした時だけ解除する', () => {
    expect(
      unlockedAchievementIds({
        ...emptyMetrics,
        xp: 5000,
        pollVotes: 10,
        eventGoing: 10,
        acceptedSuggestions: 5,
      }),
    ).toContain('community-legend');
  });

  it('Guild独自の段階Achievementを既存実績と同時に解除する', () => {
    const config = normalizeAchievementsConfig({
      customAchievements: [
        {
          key: 'chat-master',
          name: 'Chat Master',
          category: 'activity',
          enabled: true,
          stages: [
            {
              key: 'bronze',
              name: 'Bronze',
              description: '100 messages',
              emoji: '🥉',
              rarity: 'common',
              points: 50,
              secret: false,
              conditionMode: 'all',
              conditions: [{ metric: 'messages', target: 100 }],
              rewardRoleId: null,
              notificationChannelId: null,
            },
            {
              key: 'silver',
              name: 'Silver',
              description: '1000 messages',
              emoji: '🥈',
              rarity: 'rare',
              points: 150,
              secret: false,
              conditionMode: 'all',
              conditions: [{ metric: 'messages', target: 1000 }],
              rewardRoleId: null,
              notificationChannelId: null,
            },
          ],
        },
      ],
    });
    const ids = unlockedAchievementIdsWithCustom({ ...emptyMetrics, messages: 120 }, config);
    expect(ids).toContain('first-message');
    expect(ids).toContain('custom:chat-master:bronze');
    expect(ids).not.toContain('custom:chat-master:silver');
  });

  it('Rarityに応じてBadge Pointを計算する', () => {
    const common = ACHIEVEMENTS.find((achievement) => achievement.rarity === 'common')!;
    const legendary = ACHIEVEMENTS.find((achievement) => achievement.rarity === 'legendary')!;
    expect(achievementPoints(common)).toBe(10);
    expect(achievementPoints(legendary)).toBe(250);
    expect(achievementScoreForIds([common.id, legendary.id, 'unknown'])).toBe(260);
  });

  it('未解除Secretを一覧から隠し、解除後は表示する', () => {
    const config = normalizeAchievementsConfig({});
    const hidden = formatAchievements('123', emptyMetrics, [], config).join('\n');
    expect(hidden).not.toContain('Community Legend');

    const unlocks: AchievementUnlockRecord[] = [
      { achievementId: 'community-legend', unlockedAt: new Date('2026-08-12T00:00:00Z') },
    ];
    const visible = formatAchievements('123', emptyMetrics, unlocks, config).join('\n');
    expect(visible).toContain('Community Legend');
    expect(visible).toContain('250pt');
  });

  it('Custom Achievementを一覧とLeaderboardへ含める', () => {
    const config = normalizeAchievementsConfig({
      customAchievements: [
        {
          key: 'chat-master',
          name: 'Chat Master',
          category: 'activity',
          stages: [
            {
              key: 'bronze',
              name: 'Bronze',
              emoji: '🥉',
              rarity: 'rare',
              points: 75,
              conditions: [{ metric: 'messages', target: 100 }],
            },
          ],
        },
      ],
    });
    const unlocks: AchievementUnlockRecord[] = [
      { achievementId: 'custom:chat-master:bronze', unlockedAt: new Date('2026-08-12T00:00:00Z') },
    ];
    const list = formatAchievements(
      '123',
      { ...emptyMetrics, messages: 100 },
      unlocks,
      config,
    ).join('\n');
    expect(list).toContain('Bronze');
    expect(list).toContain('Chat Master');
    expect(list).toContain('75pt');

    const leaderboard = formatAchievementLeaderboard(
      [{ userId: '1', unlockCount: 1, achievementIds: ['custom:chat-master:bronze'] }],
      config,
    );
    expect(leaderboard).toContain('75pt');
    expect(leaderboard).toContain('1/55');
  });

  it('Category・Rarity・Statusで一覧を絞り込む', () => {
    const config = normalizeAchievementsConfig({ hideSecretUntilUnlocked: false });
    const unlocks: AchievementUnlockRecord[] = [
      { achievementId: 'first-message', unlockedAt: new Date('2026-08-12T00:00:00Z') },
    ];
    const unlockedActivity = formatAchievements('123', emptyMetrics, unlocks, config, {
      category: 'activity',
      status: 'unlocked',
    }).join('\n');
    expect(unlockedActivity).toContain('Hello, Community!');
    expect(unlockedActivity).not.toContain('Chat Starter');

    const legendary = formatAchievements('123', emptyMetrics, [], config, {
      rarity: 'legendary',
      status: 'locked',
    }).join('\n');
    expect(legendary).toContain('Veteran');
    expect(legendary).toContain('Community Legend');
  });

  it('ページサイズに合わせてAchievement一覧を分割する', () => {
    const config = normalizeAchievementsConfig({ pageSize: 5, hideSecretUntilUnlocked: false });
    const pages = formatAchievements('123', emptyMetrics, [], config);
    expect(pages.length).toBe(Math.ceil(ACHIEVEMENTS.length / 5));
    expect(pages.every((page) => page.length <= 1990)).toBe(true);
  });

  it('Badge Leaderboardへ解除数とポイントを表示する', () => {
    const records: AchievementLeaderboardRecord[] = [
      {
        userId: '1',
        unlockCount: 2,
        achievementIds: ['first-steps', 'veteran'],
      },
      {
        userId: '2',
        unlockCount: 1,
        achievementIds: ['first-message'],
      },
    ];
    const message = formatAchievementLeaderboard(records);
    expect(message).toContain('1. <@1>');
    expect(message).toContain('2/');
    expect(message).toContain('260pt');
    expect(message).toContain('2. <@2>');
  });
});
