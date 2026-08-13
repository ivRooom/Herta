import { describe, expect, it } from 'vitest';
import { miniGameStatsFromRows } from './mini-games-repository.js';
import { formatMiniGameStats } from './mini-games-stats.js';

describe('Mini Games v2 stats', () => {
  it('保存Metricを戦績へ安全に変換する', () => {
    const stats = miniGameStatsFromRows([
      { metric: 'minigame_plays', total: 20n },
      { metric: 'minigame_wins', total: 9n },
      { metric: 'coinflip_predictions', total: 8n },
      { metric: 'coinflip_wins', total: 5n },
      { metric: 'highlow_best_streak', total: 7n },
      { metric: 'blackjack_plays', total: 10n },
      { metric: 'blackjack_wins', total: 6n },
    ]);
    expect(stats.totalPlays).toBe(20);
    expect(stats.totalWins).toBe(9);
    expect(stats.highlowBestStreak).toBe(7);
    expect(stats.blackjackPushes).toBe(0);
  });

  it('Coin Flip的中率・High-Low最高連勝・Blackjack勝率を表示する', () => {
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
    });
    expect(message).toContain('<@12345> Mini Games Stats');
    expect(message).toContain('62.5%');
    expect(message).toContain('Best **9連勝**');
    expect(message).toContain('Natural **1**');
    expect(message).toContain('60%');
  });
});
