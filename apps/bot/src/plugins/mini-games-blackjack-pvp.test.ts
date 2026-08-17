import { describe, expect, it } from 'vitest';
import type { PlayingCard } from './mini-games-core.js';
import { isBlackjackHandComplete, settleBlackjackPvp } from './mini-games-blackjack-pvp.js';

const card = (rank: number): PlayingCard => ({ suit: 'spades', rank });

describe('settleBlackjackPvp', () => {
  it('高い21以下のhandを勝者にする', () => {
    expect(settleBlackjackPvp([card(10), card(9)], [card(10), card(8)])).toBe('player1-win');
  });

  it('Blackjackを通常21より優先する', () => {
    expect(settleBlackjackPvp([card(1), card(13)], [card(7), card(7), card(7)])).toBe(
      'player1-win',
    );
  });

  it('片方だけBustなら相手が勝つ', () => {
    expect(settleBlackjackPvp([card(10), card(9), card(5)], [card(10), card(8)])).toBe(
      'player2-win',
    );
  });

  it('同点と両者BustはPushにする', () => {
    expect(settleBlackjackPvp([card(10), card(8)], [card(9), card(9)])).toBe('push');
    expect(
      settleBlackjackPvp([card(10), card(9), card(5)], [card(10), card(8), card(7)]),
    ).toBe('push');
  });
});

describe('isBlackjackHandComplete', () => {
  it('Stand / 21 / Bustを完了扱いにする', () => {
    expect(isBlackjackHandComplete([card(10), card(8)], true)).toBe(true);
    expect(isBlackjackHandComplete([card(10), card(1)], false)).toBe(true);
    expect(isBlackjackHandComplete([card(10), card(9), card(5)], false)).toBe(true);
    expect(isBlackjackHandComplete([card(10), card(8)], false)).toBe(false);
  });
});
