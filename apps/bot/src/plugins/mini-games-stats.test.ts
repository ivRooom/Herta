import { describe, expect, it } from 'vitest';
import { miniGameStatsFromRows } from './mini-games-repository.js';
import { formatMiniGameStats } from './mini-games-stats.js';

describe('Mini Games stats', () => {
  it('保存Metricを戦績へ安全に変換する', () => {
    const stats = miniGameStatsFromRows([
      { metric: 'minigame_plays', total: 20n },
      { metric: 'minigame_wins', total: 9n },
      { metric: 'coinflip_predictions', total: 8n },
      { metric: 'coinflip_wins', total: 5n },
      { metric: 'highlow_best_streak', total: 7n },
      { metric: 'blackjack_plays', total: 10n },
      { metric: 'blackjack_wins', total: 6n },
      { metric: 'dice_sixes', total: 4n },
      { metric: 'chinchiro_plays', total: 5n },
      { metric: 'chinchiro_wins', total: 3n },
    ]);
    expect(stats.totalPlays).toBe(20);
    expect(stats.totalWins).toBe(9);
    expect(stats.highlowBestStreak).toBe(7);
    expect(stats.blackjackPushes).toBe(0);
    expect(stats.diceSixes).toBe(4);
    expect(stats.chinchiroWins).toBe(3);
  });

  it('負の保存値が混入しても戦績表示へ負値を出さない', () => {
    const stats = miniGameStatsFromRows([
      { metric: 'minigame_plays', total: -3n },
      { metric: 'blackjack_wins', total: -1n },
      { metric: 'chinchiro_wins', total: -2n },
    ]);
    expect(stats.totalPlays).toBe(0);
    expect(stats.blackjackWins).toBe(0);
    expect(stats.chinchiroWins).toBe(0);
  });

  it('全ゲームの主要戦績・勝率を表示する', () => {
    const message = formatMiniGameStats('12345', {
      totalPlays: 42,
      totalWins: 17,
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
      dicePlays: 7,
      diceSixes: 4,
      chinchiroPlays: 5,
      chinchiroWins: 3,
      chinchiroSpecials: 2,
    });
    expect(message).toContain('<@12345> Mini Games Stats');
    expect(message).toContain('62.5%');
    expect(message).toContain('Best **9連勝**');
    expect(message).toContain('Natural **1**');
    expect(message).toContain('Dice');
    expect(message).toContain('6の目 **4回**');
    expect(message).toContain('チンチロ');
    expect(message).toContain('特殊役 **2回**');
    expect(message).toContain('60%');
  });
});
