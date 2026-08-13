import { describe, expect, it } from 'vitest';
import {
  blackjackScore,
  createShuffledDeck,
  flipCoin,
  formatPlayingCard,
  resolveHighLow,
  settleBlackjack,
  shouldDealerHit,
  type PlayingCard,
} from './mini-games-core.js';

const spades = (rank: number): PlayingCard => ({ suit: 'spades', rank });
const hearts = (rank: number): PlayingCard => ({ suit: 'hearts', rank });

describe('Mini Games card rules', () => {
  it('Coin Flipは0をHeads、1をTailsとして扱う', () => {
    expect(flipCoin(() => 0)).toBe('heads');
    expect(flipCoin(() => 1)).toBe('tails');
  });

  it('52枚の重複しないデッキを生成する', () => {
    const deck = createShuffledDeck((max) => max - 1);
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map((card) => `${card.suit}:${card.rank}`));
    expect(unique.size).toBe(52);
  });

  it('Aceを11から1へ落としてBlackjack Scoreを計算する', () => {
    expect(blackjackScore([spades(1), hearts(1), spades(9)])).toMatchObject({
      total: 21,
      soft: true,
      blackjack: false,
      bust: false,
    });
    expect(blackjackScore([spades(1), hearts(13)])).toMatchObject({
      total: 21,
      blackjack: true,
      bust: false,
    });
    expect(blackjackScore([spades(10), hearts(9), spades(5)])).toMatchObject({
      total: 24,
      bust: true,
    });
  });

  it('DealerのSoft 17ルールを設定で切り替える', () => {
    const soft17 = [spades(1), hearts(6)];
    expect(shouldDealerHit(soft17, false)).toBe(false);
    expect(shouldDealerHit(soft17, true)).toBe(true);
    expect(shouldDealerHit([spades(10), hearts(6)], true)).toBe(true);
    expect(shouldDealerHit([spades(10), hearts(7)], true)).toBe(false);
  });

  it('BlackjackのNatural・Bust・Pushを判定する', () => {
    expect(settleBlackjack([spades(1), hearts(13)], [spades(10), hearts(9)])).toBe(
      'player-blackjack',
    );
    expect(settleBlackjack([spades(10), hearts(9)], [spades(1), hearts(13)])).toBe(
      'dealer-blackjack',
    );
    expect(settleBlackjack([spades(10), hearts(8), spades(7)], [spades(10), hearts(9)])).toBe(
      'dealer-win',
    );
    expect(settleBlackjack([spades(10), hearts(9)], [spades(10), hearts(8), spades(7)])).toBe(
      'player-win',
    );
    expect(settleBlackjack([spades(10), hearts(8)], [spades(10), hearts(8)])).toBe('push');
  });

  it('High-LowはAceを最強として同値をノーカウントにする', () => {
    expect(resolveHighLow(spades(10), hearts(1), 'higher')).toBe('correct');
    expect(resolveHighLow(spades(1), hearts(13), 'lower')).toBe('correct');
    expect(resolveHighLow(spades(8), hearts(8), 'higher')).toBe('tie');
    expect(resolveHighLow(spades(7), hearts(4), 'higher')).toBe('wrong');
  });

  it('カードをDiscord向け表記へ整形する', () => {
    expect(formatPlayingCard(spades(1))).toBe('♠️A');
    expect(formatPlayingCard(hearts(13))).toBe('♥️K');
  });
});
