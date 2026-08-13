import { describe, expect, it } from 'vitest';
import {
  formatDiscordCommunityLeaderboard,
  formatDiscordCommunityRank,
  resolveDiscordCommunityLeaderboardQuery,
} from './community-leaderboard-discord.js';

describe('Discord Community Leaderboard v3', () => {
  it('未指定時はXP / All TimeとPluginの表示人数を使う', () => {
    expect(resolveDiscordCommunityLeaderboardQuery({ defaultLimit: 17 })).toEqual({
      metric: 'xp',
      period: 'all',
      limit: 17,
    });
  });

  it('指標に対応しない期間は許可された期間へ自動補正する', () => {
    expect(
      resolveDiscordCommunityLeaderboardQuery({
        metric: 'season',
        period: '7d',
        limit: 99,
        defaultLimit: 10,
      }),
    ).toEqual({ metric: 'season', period: 'season', limit: 25 });

    expect(
      resolveDiscordCommunityLeaderboardQuery({
        metric: 'voice',
        period: 'season',
        defaultLimit: 10,
      }),
    ).toEqual({ metric: 'voice', period: '7d', limit: 10 });
  });

  it('LeaderboardにTop3メダル・参加人数・指標値を表示する', () => {
    const message = formatDiscordCommunityLeaderboard({
      metric: 'messages',
      period: '7d',
      participants: 42,
      seasonKey: null,
      entries: [
        { rank: 1, userId: '10001', value: 120, secondaryValue: null },
        { rank: 2, userId: '10002', value: 80, secondaryValue: null },
        { rank: 3, userId: '10003', value: 60, secondaryValue: null },
        { rank: 4, userId: '10004', value: 30, secondaryValue: null },
      ],
    });

    expect(message).toContain('Messages Leaderboard · 直近7日');
    expect(message).toContain('参加: **42人**');
    expect(message).toContain('🥇 <@10001> — 120');
    expect(message).toContain('🥈 <@10002> — 80');
    expect(message).toContain('🥉 <@10003> — 60');
    expect(message).toContain('4. <@10004> — 30');
  });

  it('Level LeaderboardはLevelと元XPを併記する', () => {
    const message = formatDiscordCommunityLeaderboard({
      metric: 'level',
      period: 'all',
      participants: 1,
      seasonKey: null,
      entries: [{ rank: 1, userId: '10001', value: 3, secondaryValue: 1_000 }],
    });

    expect(message).toContain('Level Leaderboard · All Time');
    expect(message).toContain('🥇 <@10001> — Lv.3 · 1,000 XP');
  });

  it('Season Point LeaderboardはCurrent SeasonとPointを表示する', () => {
    const message = formatDiscordCommunityLeaderboard({
      metric: 'season',
      period: 'season',
      participants: 12,
      seasonKey: '2026-08',
      entries: [{ rank: 1, userId: '10001', value: 250, secondaryValue: null }],
    });

    expect(message).toContain('Season Point Leaderboard · Current Season');
    expect(message).toContain('🥇 <@10001> — 250 pt');
  });

  it('Voice Rankは時間表示と順位/参加人数を表示する', () => {
    const message = formatDiscordCommunityRank({
      metric: 'voice',
      period: '30d',
      userId: '10001',
      rank: 4,
      participants: 83,
      value: 5_400,
      secondaryValue: null,
      seasonKey: null,
    });

    expect(message).toContain('Voice Rank · 直近30日');
    expect(message).toContain('#4 / 83');
    expect(message).toContain('1時間 30分');
  });

  it('未ランクユーザーは0値と未ランクを安全に表示する', () => {
    const message = formatDiscordCommunityRank({
      metric: 'achievements',
      period: 'all',
      userId: '10001',
      rank: null,
      participants: 0,
      value: 0,
      secondaryValue: null,
      seasonKey: null,
    });

    expect(message).toContain('未ランク');
    expect(message).toContain('Badge: **0**');
  });
});
