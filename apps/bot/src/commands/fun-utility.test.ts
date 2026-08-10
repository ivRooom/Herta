import { describe, expect, it } from 'vitest';
import {
  coreFunUtilityCommands,
  deterministicRate,
  formatShuffleDescription,
  parseChoices,
  randomIntegerInclusive,
  resolveRpsResult,
  rollDice,
  shuffleChoices,
} from './fun-utility.js';

describe('fun utility commands', () => {
  it('カンマ・読点・改行区切りの候補を正規化する', () => {
    expect(parseChoices('  赤, 青、緑\n 黄  ')).toEqual(['赤', '青', '緑', '黄']);
  });

  it('空の候補を除外し、21件以上も切り捨てず検証側へ渡す', () => {
    expect(parseChoices('赤,,,\n、 青')).toEqual(['赤', '青']);
    expect(
      parseChoices(Array.from({ length: 21 }, (_, index) => `候補${index}`).join(',')),
    ).toHaveLength(21);
  });

  it('4,000文字を超える候補も切り捨てず検証側へ渡す', () => {
    expect(parseChoices(`${'a'.repeat(4_001)},b`)[0]).toHaveLength(4_001);
  });

  it('ダイス結果を指定個数・面数の範囲で生成する', () => {
    const rolls = rollDice(20, 20);
    expect(rolls).toHaveLength(20);
    for (const roll of rolls) {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });

  it('randomの結果を両端を含む指定範囲に収める', () => {
    for (let index = 0; index < 50; index += 1) {
      const value = randomIntegerInclusive(-10, 10);
      expect(value).toBeGreaterThanOrEqual(-10);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it('random helperは逆順入力と上限外入力も安全な範囲へ正規化する', () => {
    for (let index = 0; index < 20; index += 1) {
      const reversed = randomIntegerInclusive(5, -5);
      expect(reversed).toBeGreaterThanOrEqual(-5);
      expect(reversed).toBeLessThanOrEqual(5);
    }
    expect(randomIntegerInclusive(2_000_000_000, 2_000_000_000)).toBe(1_000_000_000);
  });

  it('shuffleは入力要素を失わず並べ替える', () => {
    const source = ['a', 'b', 'c', 'd'];
    const shuffled = shuffleChoices(source);
    expect(shuffled).toHaveLength(source.length);
    expect([...shuffled].sort()).toEqual([...source].sort());
    expect(source).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shuffleの通常入力はEmbed description上限内に収まる', () => {
    const description = formatShuffleDescription(['red', 'blue', 'green']);
    expect(description.length).toBeLessThanOrEqual(4_096);
  });

  it('shuffleの最大入力ではEmbed description上限を超えることを検出できる', () => {
    const description = formatShuffleDescription(Array.from({ length: 20 }, () => 'a'.repeat(200)));
    expect(description.length).toBeGreaterThan(4_096);
  });

  it('じゃんけんの勝敗を正しく判定する', () => {
    expect(resolveRpsResult('rock', 'scissors')).toBe('win');
    expect(resolveRpsResult('paper', 'rock')).toBe('win');
    expect(resolveRpsResult('scissors', 'paper')).toBe('win');
    expect(resolveRpsResult('rock', 'paper')).toBe('lose');
    expect(resolveRpsResult('rock', 'rock')).toBe('draw');
  });

  it('rateは同じユーザーとお題で同じ0〜100の値を返す', () => {
    const first = deterministicRate('Minecraft', '100');
    const second = deterministicRate(' minecraft ', '100');
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(100);
  });

  it('8つの便利系Commandを重複なく定義する', () => {
    const names = coreFunUtilityCommands.map((command) => command.definition.name);
    expect(names).toEqual([
      'choose',
      'dice',
      'coinflip',
      'random',
      '8ball',
      'rps',
      'shuffle',
      'rate',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('追加Commandの必須入力を定義する', () => {
    const eightBall = coreFunUtilityCommands.find((command) => command.definition.name === '8ball');
    const rps = coreFunUtilityCommands.find((command) => command.definition.name === 'rps');
    const shuffle = coreFunUtilityCommands.find((command) => command.definition.name === 'shuffle');
    const rate = coreFunUtilityCommands.find((command) => command.definition.name === 'rate');

    expect(eightBall?.definition.options?.[0]).toMatchObject({
      name: 'question',
      type: 'string',
      required: true,
    });
    expect(rps?.definition.options?.[0]).toMatchObject({
      name: 'hand',
      type: 'string',
      required: true,
    });
    expect(shuffle?.definition.options?.[0]).toMatchObject({
      name: 'choices',
      type: 'string',
      required: true,
    });
    expect(rate?.definition.options?.[0]).toMatchObject({
      name: 'subject',
      type: 'string',
      required: true,
    });
  });
});
