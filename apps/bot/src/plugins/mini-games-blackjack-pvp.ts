import { blackjackScore, type PlayingCard } from './mini-games-core.js';

export type BlackjackPvpOutcome = 'player1-win' | 'player2-win' | 'push';

export function settleBlackjackPvp(
  player1: readonly PlayingCard[],
  player2: readonly PlayingCard[],
): BlackjackPvpOutcome {
  const first = blackjackScore(player1);
  const second = blackjackScore(player2);

  if (first.bust && second.bust) return 'push';
  if (first.bust) return 'player2-win';
  if (second.bust) return 'player1-win';
  if (first.blackjack && !second.blackjack) return 'player1-win';
  if (second.blackjack && !first.blackjack) return 'player2-win';
  if (first.total > second.total) return 'player1-win';
  if (second.total > first.total) return 'player2-win';
  return 'push';
}

export function isBlackjackHandComplete(cards: readonly PlayingCard[], stood: boolean): boolean {
  const score = blackjackScore(cards);
  return stood || score.bust || score.total >= 21;
}
