import { describe, expect, it } from 'vitest';
import {
  evaluateChinchiro,
  formatChinchiroTurn,
  formatDiceRoll,
  playChinchiroTurn,
  rollDice,
} from './mini-games-dice.js';

describe('Mini Games v3 dice rules', () => {
  it('Diceは個数・面数を安全な範囲へ収めて振る', () => {
    expect(rollDice(2, 6, () => 5)).toEqual([6, 6]);
    expect(rollDice(0, 1, () => 0)).toEqual([1]);
    expect(rollDice(99, 100, () => 99)).toHaveLength(10);
  });

  it('チンチロのシゴロ・ヒフミ・ゾロ目・通常目・役なしを判定する', () => {
    expect(evaluateChinchiro([6, 4, 5])).toEqual({ dice: [4, 5, 6], kind: 'shigoro' });
    expect(evaluateChinchiro([3, 1, 2])).toEqual({ dice: [1, 2, 3], kind: 'hifumi' });
    expect(evaluateChinchiro([5, 5, 5])).toEqual({ dice: [5, 5, 5], kind: 'triple', point: 5 });
    expect(evaluateChinchiro([2, 6, 2])).toEqual({ dice: [2, 2, 6], kind: 'point', point: 6 });
    expect(evaluateChinchiro([1, 4, 6])).toEqual({ dice: [1, 4, 6], kind: 'no-hand' });
  });

  it('役なしなら最大3投まで振り直し、役が出た時点で止める', () => {
    const values = [0, 3, 5, 1, 1, 5];
    const turn = playChinchiroTurn(3, () => values.shift() ?? 0);
    expect(turn.attempts).toHaveLength(2);
    expect(turn.attempts[0]?.kind).toBe('no-hand');
    expect(turn.result).toMatchObject({ kind: 'point', point: 6 });
  });

  it('DiceとチンチロをDiscord向け表示へ整形する', () => {
    expect(formatDiceRoll([6, 3], 6)).toContain('2d6');
    expect(formatDiceRoll([6, 3], 6)).toContain('合計: **9**');
    const message = formatChinchiroTurn({
      attempts: [{ dice: [4, 5, 6], kind: 'shigoro' }],
      result: { dice: [4, 5, 6], kind: 'shigoro' },
    });
    expect(message).toContain('シゴロ');
    expect(message).toContain('結果: **🎉 シゴロ（4-5-6）**');
  });

  it('不正なチンチロ入力を拒否する', () => {
    expect(() => evaluateChinchiro([1, 2])).toThrow();
    expect(() => evaluateChinchiro([1, 2, 7])).toThrow();
  });
});
