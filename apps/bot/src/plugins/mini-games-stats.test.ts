import { describe, expect, it } from 'vitest';
import { miniGameStatsFromRows } from './mini-games-repository.js';
import { formatMiniGameLeaderboard, formatMiniGameStats } from './mini-games-stats.js';

describe('Mini Games v3 stats', () => {
  it('保存Metricを戦績へ安全に変換する', () => {
    const stats = miniGameStatsFromRows([
      { metric: 'minigame_plays', total: 20n },
      { metric: 'minigame_wins', total: 9n },
      { metric: 'coinflip_predictions', total: 8n },
      { metric: 'coinflip_wins', total: 5n },
      { metric: 'highlow_best_streak', total: 7n },
      { metric: 'blackjack_plays', total: 10n },
      { metric: 'blackjack_wins', total: 6n },
      { metric: 'dice_plays', total: 4n },
      { metric: 'chinchiro_plays', total: 3n },
      { metric: 'chinchiro_shigoro', total: 1n },
    ]);
    expect(stats.totalPlays).toBe(20);
    expect(stats.totalWins).toBe(9);
    expect(stats.highlowBestStreak).toBe(7);
    expect(stats.blackjackPushes).toBe(0);
    expect(stats.dicePlays).toBe(4);
    expect(stats.chinchiroShigoro).toBe(1);
  });

  it('負の保存値が混入しても戦績表示へ負値を出さない', () => {
    const stats = miniGameStatsFromRows([
      { metric: 'minigame_plays', total: -3n },
      { metric: 'blackjack_wins', total: -1n },
    ]);
    expect(stats.totalPlays).toBe(0);
    expect(stats.blackjackWins).toBe(0);
  });

  it('Coin Flip的中率・High-Low最高連勝・Blackjack勝率・Dice・チンチロを表示する', () => {
    const message = formatMiniGameStats('12345', {
      totalPlays: 30,
      totalWins: 14,
      coinflipPlays: 10,
      coinflipPredictions: 8,
      coinflipWins: 5,
      highlowPlays: 10,
      highlowRoundWins: 24,
      highlowClears: 2,
      highlowBestStreak: 9,
      blackjackPlays: 10,
      blackjackWins: 6,
      blackjackPushes: 2,
      blackjackNaturals: 1,
      dicePlays: 4,
      chinchiroPlays: 3,
      chinchiroShigoro: 1,
      chinchiroZorome: 1,
      chinchiroHifumi: 1,
    });
    expect(message).toContain('<@12345> Mini Games Stats');
    expect(message).toContain('62.5%');
    expect(message).toContain('Best **9連勝**');
    expect(message).toContain('Natural **1**');
    expect(message).toContain('60%');
    expect(message).toContain('Dice');
    expect(message).toContain('シゴロ **1**');
  });

  it('Leaderboardは上位3名をメダル表示しHigh-Lowは連勝単位にする', () => {
    const records = [
      { userId: '1', value: 12 },
      { userId: '2', value: 9 },
      { userId: '3', value: 7 },
      { userId: '4', value: 5 },
    ];
    const wins = formatMiniGameLeaderboard('wins', records);
    expect(wins).toContain('🥇 <@1> — **12回**');
    expect(wins).toContain('🥈 <@2> — **9回**');
    expect(wins).toContain('🥉 <@3> — **7回**');
    expect(wins).toContain('4. <@4> — **5回**');

    const highlow = formatMiniGameLeaderboard('highlow', [{ userId: '1', value: 18 }]);
    expect(highlow).toContain('High-Low 最高連勝');
    expect(highlow).toContain('**18連勝**');
  });
});
