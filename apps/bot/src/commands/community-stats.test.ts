import { describe, expect, it, vi } from 'vitest';
import type { AchievementMetrics } from '../plugins/achievements-repository.js';
import { buildCommunityStatsFields, communityStatsCommand } from './community-stats.js';

function metrics(overrides: Partial<AchievementMetrics> = {}): AchievementMetrics {
  return {
    xp: 0,
    messages: 0,
    reactionsGiven: 0,
    reactionsReceived: 0,
    voiceSeconds: 0,
    minecraftSeconds: 0,
    pollVotes: 3,
    giveawayEntries: 5,
    eventGoing: 2,
    suggestions: 4,
    acceptedSuggestions: 1,
    challengeCompletions: 7,
    seasonPoints: 120,
    minigamePlays: 0,
    minigameWins: 0,
    coinflipWins: 0,
    highLowBestStreak: 0,
    highLowClears: 0,
    blackjackWins: 0,
    blackjackNaturals: 0,
    ...overrides,
  };
}

describe('buildCommunityStatsFields', () => {
  it('Poll/Giveaway/Event/提案/チャレンジをコミュニティ参加統計として整形する', () => {
    const fields = buildCommunityStatsFields(metrics());

    expect(fields).toEqual([
      { name: '🗳️ 投票したPoll数', value: '3', inline: true },
      { name: '🎁 参加したGiveaway数', value: '5', inline: true },
      { name: '📅 参加予定のEvent数', value: '2', inline: true },
      { name: '💡 提案数', value: '4', inline: true },
      { name: '✅ 採用された提案数', value: '1', inline: true },
      { name: '🏆 チャレンジ達成数', value: '7', inline: true },
    ]);
  });

  it('大きな数値を3桁区切りで表示する', () => {
    const fields = buildCommunityStatsFields(metrics({ giveawayEntries: 12_345 }));
    expect(fields[1]).toEqual({
      name: '🎁 参加したGiveaway数',
      value: '12,345',
      inline: true,
    });
  });

  it('ミニゲーム統計はフィールドへ含めない(Issue #408の非対象)', () => {
    const fields = buildCommunityStatsFields(
      metrics({ minigamePlays: 99, coinflipWins: 42, blackjackNaturals: 3 }),
    );
    const names = fields.map((field) => field.name);
    expect(names.some((name) => name.includes('ミニゲーム'))).toBe(false);
    expect(fields).toHaveLength(6);
  });
});

describe('communityStatsCommand', () => {
  it('Guild外では実行を拒否する', async () => {
    const reply = vi.fn();
    await communityStatsCommand.execute({
      guildId: null,
      reply,
    } as unknown as Parameters<typeof communityStatsCommand.execute>[0]);

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'サーバー内でのみ利用できます。' }),
    );
  });
});
