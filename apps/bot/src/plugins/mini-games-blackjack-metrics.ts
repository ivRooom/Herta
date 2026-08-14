import { blackjackScore, settleBlackjack, type PlayingCard } from './mini-games-core.js';
import type { MiniGameMetric } from './mini-games-repository.js';

export function blackjackSettlementMetrics(
  player: readonly PlayingCard[],
  dealer: readonly PlayingCard[],
): Array<readonly [MiniGameMetric, number]> {
  const outcome = settleBlackjack(player, dealer);
  const metrics: Array<readonly [MiniGameMetric, number]> = [];

  if (outcome === 'player-win' || outcome === 'player-blackjack') {
    metrics.push(['blackjack_wins', 1], ['minigame_wins', 1]);
  }
  if (outcome === 'push') metrics.push(['blackjack_pushes', 1]);
  if (blackjackScore(player).blackjack) metrics.push(['blackjack_naturals', 1]);

  return metrics;
}
