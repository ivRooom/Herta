import { randomInt } from 'node:crypto';

export type CoinFace = 'heads' | 'tails';
export type HighLowChoice = 'higher' | 'lower';
export type HighLowResult = 'correct' | 'wrong' | 'tie';
export type CardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export interface PlayingCard {
  suit: CardSuit;
  rank: number;
}

export interface BlackjackScore {
  total: number;
  soft: boolean;
  blackjack: boolean;
  bust: boolean;
}

export type BlackjackOutcome =
  | 'player-blackjack'
  | 'dealer-blackjack'
  | 'player-win'
  | 'dealer-win'
  | 'push';

const SUITS: readonly CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export function flipCoin(random: (max: number) => number = randomInt): CoinFace {
  return random(2) === 0 ? 'heads' : 'tails';
}

export function createShuffledDeck(
  random: (max: number) => number = randomInt,
): PlayingCard[] {
  const deck: PlayingCard[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank += 1) deck.push({ suit, rank });
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = random(index + 1);
    [deck[index], deck[target]] = [deck[target]!, deck[index]!];
  }
  return deck;
}

export function drawCard(deck: PlayingCard[]): PlayingCard {
  const card = deck.pop();
  if (!card) throw new Error('カードデッキが空です');
  return card;
}

export function blackjackScore(cards: readonly PlayingCard[]): BlackjackScore {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 1) {
      aces += 1;
      total += 11;
    } else {
      total += Math.min(card.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  const soft = aces > 0;
  return {
    total,
    soft,
    blackjack: cards.length === 2 && total === 21,
    bust: total > 21,
  };
}

export function shouldDealerHit(cards: readonly PlayingCard[], hitSoft17: boolean): boolean {
  const score = blackjackScore(cards);
  if (score.bust) return false;
  if (score.total < 17) return true;
  return score.total === 17 && score.soft && hitSoft17;
}

export function settleBlackjack(
  playerCards: readonly PlayingCard[],
  dealerCards: readonly PlayingCard[],
): BlackjackOutcome {
  const player = blackjackScore(playerCards);
  const dealer = blackjackScore(dealerCards);
  if (player.blackjack && dealer.blackjack) return 'push';
  if (player.blackjack) return 'player-blackjack';
  if (dealer.blackjack) return 'dealer-blackjack';
  if (player.bust) return 'dealer-win';
  if (dealer.bust) return 'player-win';
  if (player.total > dealer.total) return 'player-win';
  if (dealer.total > player.total) return 'dealer-win';
  return 'push';
}

export function highLowValue(card: PlayingCard): number {
  return card.rank === 1 ? 14 : card.rank;
}

export function resolveHighLow(
  current: PlayingCard,
  next: PlayingCard,
  choice: HighLowChoice,
): HighLowResult {
  const currentValue = highLowValue(current);
  const nextValue = highLowValue(next);
  if (nextValue === currentValue) return 'tie';
  if (choice === 'higher') return nextValue > currentValue ? 'correct' : 'wrong';
  return nextValue < currentValue ? 'correct' : 'wrong';
}

export function formatPlayingCard(card: PlayingCard): string {
  const suit =
    card.suit === 'spades'
      ? '♠️'
      : card.suit === 'hearts'
        ? '♥️'
        : card.suit === 'diamonds'
          ? '♦️'
          : '♣️';
  const rank =
    card.rank === 1
      ? 'A'
      : card.rank === 11
        ? 'J'
        : card.rank === 12
          ? 'Q'
          : card.rank === 13
            ? 'K'
            : String(card.rank);
  return `${suit}${rank}`;
}

export function formatCards(cards: readonly PlayingCard[]): string {
  return cards.map(formatPlayingCard).join(' ');
}
