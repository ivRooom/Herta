import { describe, expect, it } from 'vitest';
import {
  jankenChoiceLabel,
  playJankenSeries,
  playNumberGuess,
  randomJankenChoice,
  resolveJanken,
} from './mini-games-v4-core.js';

describe('Mini Games v4 / Janken', () => {
  it('じゃんけんの勝敗を解決する', () => {
    expect(resolveJanken('rock', 'scissors')).toBe('player-win');
    expect(resolveJanken('paper', 'scissors')).toBe('dealer-win');
    expect(resolveJanken('rock', 'rock')).toBe('draw');
  });

  it('乱数を3種類の手へ変換する', () => {
    expect(randomJankenChoice(() => 0)).toBe('rock');
    expect(randomJankenChoice(() => 0.34)).toBe('paper');
    expect(randomJankenChoice(() => 0.99)).toBe('scissors');
  });

  it('Best of 3で2勝した時点でシリーズを終了する', () => {
    const values = [0.99, 0.99];
    let index = 0;
    const series = playJankenSeries('rock', 3, () => values[index++] ?? 0.99);
    expect(series.playerWins).toBe(2);
    expect(series.dealerWins).toBe(0);
    expect(series.winner).toBe('player');
    expect(series.rounds).toHaveLength(2);
  });

  it('無効なBest ofは1回勝負へ正規化する', () => {
    const series = playJankenSeries('paper', 9, () => 0);
    expect(series.rounds).toHaveLength(1);
    expect(series.winner).toBe('player');
    expect(jankenChoiceLabel('scissors')).toContain('チョキ');
  });
});

describe('Mini Games v4 / Number Guess', () => {
  it('完全一致をhitとして判定する', () => {
    const result = playNumberGuess(50, () => 0.49);
    expect(result).toMatchObject({ guess: 50, target: 50, difference: 0, result: 'hit' });
  });

  it('5以内の差をnearとして判定する', () => {
    const result = playNumberGuess(55, () => 0.49);
    expect(result).toMatchObject({ target: 50, difference: 5, result: 'near', direction: 'lower' });
  });

  it('入力と乱数を1〜100の範囲へ収める', () => {
    expect(playNumberGuess(999, () => 1)).toMatchObject({ guess: 100, target: 100 });
    expect(playNumberGuess(-10, () => 0)).toMatchObject({ guess: 1, target: 1 });
  });
});
