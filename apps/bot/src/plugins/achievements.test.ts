import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  formatAchievements,
  normalizeAchievementsConfig,
  unlockedAchievementIds,
} from './achievements.js';
import type { AchievementMetrics, AchievementUnlockRecord } from './achievements-repository.js';

const emptyMetrics: AchievementMetrics = {
  xp: 0,
  pollVotes: 0,
  giveawayEntries: 0,
  eventGoing: 0,
  suggestions: 0,
  acceptedSuggestions: 0,
};

describe('Achievements v1', () => {
  it('設定値を安全な範囲へ正規化する', () => {
    expect(normalizeAchievementsConfig({ pageSize: 99, showLocked: false })).toEqual({
      enabled: true,
      ephemeralSync: true,
      showLocked: false,
      showProgress: true,
      hideSecretUntilUnlocked: true,
      pageSize: 20,
    });
  });

  it('活動メトリクスから複数のAchievementを解除する', () => {
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

  it('Secret Achievementは複合条件を満たした時だけ解除する', () => {
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

  it('未解除Secretを一覧から隠し、解除後は表示する', () => {
    const config = normalizeAchievementsConfig({});
    const hidden = formatAchievements('123', emptyMetrics, [], config).join('\n');
    expect(hidden).not.toContain('Community Legend');

    const unlocks: AchievementUnlockRecord[] = [
      { achievementId: 'community-legend', unlockedAt: new Date('2026-08-12T00:00:00Z') },
    ];
    const visible = formatAchievements('123', emptyMetrics, unlocks, config).join('\n');
    expect(visible).toContain('Community Legend');
  });

  it('ページサイズに合わせてAchievement一覧を分割する', () => {
    const config = normalizeAchievementsConfig({ pageSize: 5, hideSecretUntilUnlocked: false });
    const pages = formatAchievements('123', emptyMetrics, [], config);
    expect(pages.length).toBe(Math.ceil(ACHIEVEMENTS.length / 5));
    expect(pages.every((page) => page.length <= 1990)).toBe(true);
  });
});
