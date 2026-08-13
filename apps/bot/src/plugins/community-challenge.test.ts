import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_CHALLENGES,
  communitySeasonLevelProgress,
  getCommunityChallengeWindow,
  getCommunitySeasonWindow,
  selectCommunityChallenges,
} from '@herta/shared';
import {
  formatChallengeCatalog,
  formatChallengePeriod,
  formatSeasonStatus,
  normalizeCommunityChallengeConfig,
  progressBar,
} from './community-challenge.js';

describe('Community Challenge / Season v1', () => {
  it('設定値を安全な範囲へ正規化する', () => {
    expect(
      normalizeCommunityChallengeConfig({
        dailyChallengeCount: 99,
        weeklyChallengeCount: 0,
        autoSyncCooldownSeconds: 1,
        seasonPointMultiplier: 99,
        seasonLevelPoints: 1,
        leaderboardSize: 100,
        completionChannelId: 'bad',
        includeMinecraftChallenges: false,
      }),
    ).toEqual({
      enabled: true,
      dailyEnabled: true,
      weeklyEnabled: true,
      dailyChallengeCount: 5,
      weeklyChallengeCount: 1,
      includeMinecraftChallenges: false,
      autoSync: true,
      autoSyncCooldownSeconds: 10,
      notifyCompletions: true,
      completionChannelId: null,
      mentionOnCompletion: false,
      seasonPointMultiplier: 3,
      seasonLevelPoints: 25,
      leaderboardSize: 25,
      ephemeralSync: true,
    });
  });

  it('Daily 15種・Weekly 15種の30 Challengeを提供する', () => {
    expect(COMMUNITY_CHALLENGES).toHaveLength(30);
    expect(COMMUNITY_CHALLENGES.filter((item) => item.period === 'daily')).toHaveLength(15);
    expect(COMMUNITY_CHALLENGES.filter((item) => item.period === 'weekly')).toHaveLength(15);
  });

  it('Guildと期間が同じなら同じChallengeを選び、活動指標は重複させない', () => {
    const input = {
      guildId: 'guild-1',
      period: 'daily' as const,
      periodKey: '2026-08-12',
      count: 5,
      includeMinecraft: true,
    };
    const first = selectCommunityChallenges(input);
    const second = selectCommunityChallenges(input);
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(new Set(first.map((item) => item.metric)).size).toBe(first.length);
  });

  it('Minecraftを無効にするとMinecraft Challengeを配布しない', () => {
    const selected = selectCommunityChallenges({
      guildId: 'guild-1',
      period: 'weekly',
      periodKey: '2026-08-10',
      count: 5,
      includeMinecraft: false,
    });
    expect(selected).toHaveLength(4);
    expect(selected.some((item) => item.metric === 'minecraft_seconds')).toBe(false);
  });

  it('JSTの日次・週次境界と28日Seasonを計算する', () => {
    const now = new Date('2026-08-12T06:00:00.000Z'); // 15:00 JST Wednesday
    const daily = getCommunityChallengeWindow('daily', now);
    const weekly = getCommunityChallengeWindow('weekly', now);
    const season = getCommunitySeasonWindow(now);
    expect(daily.key).toBe('2026-08-12');
    expect(daily.startsAt.toISOString()).toBe('2026-08-11T15:00:00.000Z');
    expect(weekly.key).toBe('2026-08-10');
    expect(weekly.startsAt.toISOString()).toBe('2026-08-09T15:00:00.000Z');
    expect(season.endsAt.getTime() - season.startsAt.getTime()).toBe(28 * 86_400_000);
    expect(season.startsAt.getUTCDay()).toBe(0); // JST Monday = UTC Sunday 15:00
  });

  it('Season LevelをPointから計算する', () => {
    expect(communitySeasonLevelProgress(250, 100)).toEqual({
      level: 3,
      current: 50,
      needed: 100,
      percentage: 50,
    });
  });

  it('進捗バーは未達成状態を満タンに見せない', () => {
    expect(progressBar(95, 100, 10)).toBe('█████████░');
    expect(progressBar(100, 100, 10)).toBe('██████████');
  });

  it('Daily Challengeの進捗とALL CLEARを表示する', () => {
    const config = normalizeCommunityChallengeConfig({ seasonPointMultiplier: 2 });
    const definitions = COMMUNITY_CHALLENGES.filter((item) => item.period === 'daily').slice(0, 3);
    const state = {
      period: 'daily' as const,
      window: getCommunityChallengeWindow('daily', new Date('2026-08-12T06:00:00Z')),
      definitions,
      metrics: {
        messages: 100,
        reactions_given: 100,
        reactions_received: 100,
        voice_seconds: 100_000,
        minecraft_seconds: 100_000,
        minigame_plays: 0,
        minigame_wins: 0,
        highlow_round_wins: 0,
        blackjack_wins: 0,
      },
      completions: definitions.map((definition, index) => ({
        challengeId: definition.id,
        points: definition.basePoints * 2,
        completedAt: new Date(`2026-08-12T0${index}:00:00Z`),
      })),
      newlyCompleted: [],
    };
    const message = formatChallengePeriod(state, config);
    expect(message).toContain('Daily Challenges');
    expect(message).toContain('Clear 3/3');
    expect(message).toContain('ALL CLEAR');
    expect(message).toContain('+20pt');
    expect(message.length).toBeLessThanOrEqual(1990);
  });

  it('Season StatusへPoint・Level・Rank・Streakを表示する', () => {
    const message = formatSeasonStatus(
      '123',
      { points: 250, completionCount: 9, rank: 2, participants: 18 },
      4,
      normalizeCommunityChallengeConfig({}),
      new Date('2026-08-12T06:00:00Z'),
    );
    expect(message).toContain('Season Level **3**');
    expect(message).toContain('**250pt**');
    expect(message).toContain('Season Rank **#2**');
    expect(message).toContain('Streak **4日**');
  });

  it('Challenge CatalogをDiscord文字数上限内でページ分割する', () => {
    const pages = formatChallengeCatalog(undefined, normalizeCommunityChallengeConfig({}));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= 1990)).toBe(true);
    const joined = pages.join('\n');
    expect(joined).toContain('Hello There');
    expect(joined).toContain('Minecraft Veteran');
  });
});
