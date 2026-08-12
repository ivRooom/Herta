import { describe, expect, it } from 'vitest';
import type { CommunityProfileSnapshotData } from '@herta/db';
import {
  canViewCommunityProfile,
  formatCommunityProfile,
  formatDuration,
  normalizeCommunityProfileConfig,
} from './community-profile.js';

const snapshot: CommunityProfileSnapshotData = {
  guildId: 'guild-1',
  userId: '123',
  period: '30d',
  xp: { xp: 5200, rank: 2, participants: 18 },
  activity: {
    messages: 640,
    reactionsGiven: 120,
    reactionsReceived: 80,
    voiceSeconds: 18_600,
    minecraftSeconds: 7_200,
  },
  achievements: {
    unlocks: [
      { achievementId: 'all-rounder', unlockedAt: new Date('2026-08-12T02:00:00Z') },
      { achievementId: 'first-steps', unlockedAt: new Date('2026-08-10T02:00:00Z') },
    ],
    rank: 4,
    participants: 15,
  },
  preference: {
    isPublic: true,
    featuredAchievementIds: ['all-rounder', 'first-steps'],
    titleAchievementId: 'all-rounder',
  },
};

describe('Community Profile v2', () => {
  it('設定値を安全な範囲へ正規化する', () => {
    expect(
      normalizeCommunityProfileConfig({
        defaultActivityPeriod: 'invalid',
        recentAchievementCount: 99,
        featuredBadgeLimit: 0,
        showXp: false,
      }),
    ).toEqual({
      enabled: true,
      ephemeralResponses: false,
      allowViewingOthers: true,
      defaultActivityPeriod: '30d',
      showXp: false,
      showActivity: true,
      showAchievements: true,
      showAchievementCompletion: true,
      showAchievementRarityBreakdown: true,
      showProfileTitle: true,
      showRankings: true,
      showRecentAchievements: true,
      recentAchievementCount: 5,
      featuredBadgeLimit: 1,
      showMinecraftActivity: true,
      showZeroActivity: false,
    });
  });

  it('XP・Activity・Achievement・Badge Showcaseを1つのプロフィールへまとめる', () => {
    const output = formatCommunityProfile(snapshot, normalizeCommunityProfileConfig({}));
    expect(output).toContain('Community Profile');
    expect(output).toContain('Level **7**');
    expect(output).toContain('XP Rank **#2**');
    expect(output).toContain('**2/38** unlocked');
    expect(output).toContain('**5%**');
    expect(output).toContain('Title **All-Rounder**');
    expect(output).toContain('Common 1/');
    expect(output).toContain('Epic 1/');
    expect(output).toContain('Badge Rank **#4**');
    expect(output).toContain('Messages **640**');
    expect(output).toContain('Voice **5h 10m**');
    expect(output).toContain('All-Rounder');
    expect(output).toContain('First Steps');
    expect(output.length).toBeLessThanOrEqual(1990);
  });

  it('非公開プロフィールは本人だけ閲覧できる', () => {
    const privateSnapshot = {
      ...snapshot,
      preference: { ...snapshot.preference, isPublic: false },
    };
    const config = normalizeCommunityProfileConfig({});
    expect(canViewCommunityProfile('123', '123', privateSnapshot, config)).toBe(true);
    expect(canViewCommunityProfile('456', '123', privateSnapshot, config)).toBe(false);
  });

  it('サーバー設定で他ユーザー閲覧を停止できる', () => {
    const config = normalizeCommunityProfileConfig({ allowViewingOthers: false });
    expect(canViewCommunityProfile('456', '123', snapshot, config)).toBe(false);
    expect(canViewCommunityProfile('123', '123', snapshot, config)).toBe(true);
  });

  it('Activity時間をプロフィール向けに整形する', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(3_599)).toBe('59m');
    expect(formatDuration(18_600)).toBe('5h 10m');
  });
});
