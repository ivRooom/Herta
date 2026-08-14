import { describe, expect, it } from 'vitest';
import {
  compareChinchiroHands,
  evaluateChinchiroHand,
  formatChinchiroHand,
  rollChinchiroTurn,
  rollDice,
} from './mini-games-v3-core.js';

describe('Mini Games v3 core', () => {
  it('Diceは個数と面数を安全な範囲へ制限する', () => {
    expect(rollDice(6, 3, () => 0)).toEqual([1, 1, 1]);
    expect(rollDice(6, 3, () => 0.999)).toEqual([6, 6, 6]);
    expect(rollDice(100, 1, () => 0.999)).toEqual([100]);
    expect(rollDice(1, 99, () => 0.5)).toHaveLength(10);
  });

  it('チンチロの代表役を判定する', () => {
    expect(evaluateChinchiroHand([1, 1, 1]).kind).toBe('pinzoro');
    expect(evaluateChinchiroHand([6, 6, 6])).toMatchObject({ kind: 'triple', point: 6 });
    expect(evaluateChinchiroHand([4, 5, 6]).kind).toBe('shigoro');
    expect(evaluateChinchiroHand([1, 2, 3]).kind).toBe('hifumi');
    expect(evaluateChinchiroHand([2, 2, 6])).toMatchObject({ kind: 'point', point: 6 });
    expect(evaluateChinchiroHand([2, 4, 6]).kind).toBe('no-hand');
  });

  it('ピンゾロ > ゾロ目 > シゴロ > 通常の目 > 役なし > ヒフミで比較する', () => {
    const pinzoro = evaluateChinchiroHand([1, 1, 1]);
    const triple = evaluateChinchiroHand([6, 6, 6]);
    const shigoro = evaluateChinchiroHand([4, 5, 6]);
    const point = evaluateChinchiroHand([5, 5, 6]);
    const noHand = evaluateChinchiroHand([2, 4, 6]);
    const hifumi = evaluateChinchiroHand([1, 2, 3]);
    expect(compareChinchiroHands(pinzoro, triple)).toBe('player-win');
    expect(compareChinchiroHands(triple, shigoro)).toBe('player-win');
    expect(compareChinchiroHands(shigoro, point)).toBe('player-win');
    expect(compareChinchiroHands(point, noHand)).toBe('player-win');
    expect(compareChinchiroHands(noHand, hifumi)).toBe('player-win');
    expect(compareChinchiroHands(point, point)).toBe('push');
    expect(formatChinchiroHand(pinzoro)).toContain('ピンゾロ');
  });

  it('役なしの場合だけ最大3投まで振り直す', () => {
    const values = [0.2, 0.55, 0.9, 0, 0.2, 0.4];
    let index = 0;
    const turn = rollChinchiroTurn(() => values[index++] ?? 0, 3);
    expect(turn.rolls).toBe(2);
    expect(turn.hand.kind).not.toBe('no-hand');
  });
});
