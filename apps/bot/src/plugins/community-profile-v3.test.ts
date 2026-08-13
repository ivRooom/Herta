import type { CommunityProfileSnapshotData } from '@herta/db';
import { describe, expect, it } from 'vitest';
import type { AchievementMetrics } from './achievements-repository.js';
import {
  appendCommunityProfileMomentum,
  appendCommunityProfileSeason,
  formatCommunityProfileComparison,
  formatMomentumTrend,
  getNextAchievementMilestones,
  type CommunityProfileV3Data,
} from './community-profile-v3.js';

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
      { achievementId: 'first-steps', unlockedAt: new Date('2026-08-10T02:00:00Z') },
      { achievementId: 'server-regular', unlockedAt: new Date('2026-08-11T02:00:00Z') },
    ],
    rank: 4,
    participants: 15,
  },
  preference: {
    isPublic: true,
    featuredAchievementIds: ['server-regular'],
    titleAchievementId: 'server-regular',
  },
};

const metrics: AchievementMetrics = {
  xp: 19_000,
  messages: 950,
  reactionsGiven: 490,
  reactionsReceived: 98,
  voiceSeconds: 35_000,
  minecraftSeconds: 80_000,
  pollVotes: 9,
  giveawayEntries: 1,
  eventGoing: 9,
  suggestions: 9,
  acceptedSuggestions: 4,
  challengeCompletions: 24,
  seasonPoints: 490,
  minigamePlays: 0,
  minigameWins: 0,
  coinflipWins: 0,
  highLowBestStreak: 0,
  highLowClears: 0,
  blackjackWins: 0,
  blackjackNaturals: 0,
};

const v3: CommunityProfileV3Data = {
  seasonKey: '2026-07-20',
  seasonIndex: 8,
  seasonEndsAt: new Date('2026-08-17T00:00:00+09:00'),
  season: { points: 250, completionCount: 8, rank: 3, participants: 12 },
  seasonLevelPoints: 100,
  dailyClearStreak: 4,
  metrics,
  momentum: {
    messages: { current: 84, previous: 70 },
    reactionsGiven: { current: 40, previous: 40 },
    reactionsReceived: { current: 20, previous: 0 },
    voiceSeconds: { current: 7200, previous: 10_800 },
    minecraftSeconds: { current: 3600, previous: 0 },
  },
};

describe('Community Profile v3', () => {
  it('Current SeasonへLevel・Point・Rank・Challenge Clear・Streakを表示する', () => {
    const lines: string[] = [];
    appendCommunityProfileSeason(lines, v3, {
      showRankings: true,
      showProgress: true,
      showDailyStreak: true,
    });
    const output = lines.join('\n');
    expect(output).toContain('Current Season · Season 8');
    expect(output).toContain('Level **3**');
    expect(output).toContain('250pt');
    expect(output).toContain('Challenge Clear **8回**');
    expect(output).toContain('Season Rank **#3**');
    expect(output).toContain('Daily ALL CLEAR Streak **4日**');
  });

  it('解除済み・Secretを除外し解除に近いAchievementを優先する', () => {
    const milestones = getNextAchievementMilestones(snapshot, metrics, 3);
    expect(milestones).toHaveLength(3);
    expect(milestones.every((item) => item.achievement.secret !== true)).toBe(true);
    expect(milestones.map((item) => item.achievement.id)).not.toContain('server-regular');
    expect(milestones[0]!.percentage).toBeGreaterThanOrEqual(milestones[1]!.percentage);
    expect(milestones[1]!.percentage).toBeGreaterThanOrEqual(milestones[2]!.percentage);
  });

  it('Momentumを増加・維持・新規・減少として表現する', () => {
    expect(formatMomentumTrend({ current: 120, previous: 100 })).toBe('↑ 20%');
    expect(formatMomentumTrend({ current: 100, previous: 100 })).toBe('→ 0%');
    expect(formatMomentumTrend({ current: 5, previous: 0 })).toBe('🆕 new');
    expect(formatMomentumTrend({ current: 50, previous: 100 })).toBe('↓ 50%');
  });

  it('7日MomentumへActivityを表示しMinecraft表示を切り替えられる', () => {
    const visible: string[] = [];
    appendCommunityProfileMomentum(visible, v3.momentum, true);
    const visibleOutput = visible.join('\n');
    expect(visibleOutput).toContain('7-day Momentum');
    expect(visibleOutput).toContain('Messages **84** · ↑ 20%');
    expect(visibleOutput).toContain('Voice **2h 0m** · ↓ 33%');
    expect(visibleOutput).toContain('Minecraft **1h 0m** · 🆕 new');

    const hidden: string[] = [];
    appendCommunityProfileMomentum(hidden, v3.momentum, false);
    expect(hidden.join('\n')).not.toContain('Minecraft');
  });

  it('Profile CompareへXP・Achievement・Season・Activityを並べる', () => {
    const other: CommunityProfileSnapshotData = {
      ...snapshot,
      userId: '456',
      xp: { xp: 2100, rank: 8, participants: 18 },
      activity: {
        messages: 320,
        reactionsGiven: 50,
        reactionsReceived: 20,
        voiceSeconds: 3600,
        minecraftSeconds: 0,
      },
      achievements: {
        unlocks: [{ achievementId: 'first-steps', unlockedAt: new Date('2026-08-09T00:00:00Z') }],
        rank: 10,
        participants: 15,
      },
    };
    const otherV3: CommunityProfileV3Data = {
      ...v3,
      season: { points: 90, completionCount: 3, rank: 9, participants: 12 },
      dailyClearStreak: 1,
    };
    const output = formatCommunityProfileComparison(snapshot, v3, other, otherV3, {
      showXp: true,
      showAchievements: true,
      showActivity: true,
      showSeason: true,
      showMinecraftActivity: true,
    });
    expect(output).toContain('Community Profile Compare');
    expect(output).toContain('<@123> **vs** <@456>');
    expect(output).toContain('XP **5,200** / **2,100**');
    expect(output).toContain('Season Level **3** / **1**');
    expect(output).toContain('Messages **640** / **320**');
    expect(output.length).toBeLessThanOrEqual(1990);
  });
});
