import { describe, expect, it } from 'vitest';
import { blackjackSettlementMetrics } from './mini-games-blackjack-metrics.js';
import type { PlayingCard } from './mini-games-core.js';

const ace: PlayingCard = { suit: 'spades', rank: 1 };
const king: PlayingCard = { suit: 'hearts', rank: 13 };
const queen: PlayingCard = { suit: 'diamonds', rank: 12 };
const ten: PlayingCard = { suit: 'clubs', rank: 10 };

function names(metrics: readonly (readonly [string, number])[]): string[] {
  return metrics.map(([metric]) => metric);
}

describe('Blackjack settlement metrics', () => {
  it('プレイヤーとDealerが両方NaturalでもNaturalとPushを記録する', () => {
    expect(names(blackjackSettlementMetrics([ace, king], [ace, queen]))).toEqual(
      expect.arrayContaining(['blackjack_pushes', 'blackjack_naturals']),
    );
  });

  it('プレイヤーだけNaturalなら勝利・総勝利・Naturalを記録する', () => {
    expect(names(blackjackSettlementMetrics([ace, king], [ten, queen]))).toEqual(
      expect.arrayContaining(['blackjack_wins', 'minigame_wins', 'blackjack_naturals']),
    );
  });
});
