import { describe, expect, it } from 'vitest';
import {
  coreFunUtilityCommands,
  parseChoices,
  randomIntegerInclusive,
  rollDice,
} from './fun-utility.js';

describe('fun utility commands', () => {
  it('カンマ・読点・改行区切りの候補を正規化する', () => {
    expect(parseChoices('  赤, 青、緑\n 黄  ')).toEqual(['赤', '青', '緑', '黄']);
  });

  it('空の候補を除外し、21件以上も切り捨てず検証側へ渡す', () => {
    expect(parseChoices('赤,,,\n、 青')).toEqual(['赤', '青']);
    expect(parseChoices(Array.from({ length: 21 }, (_, index) => `候補${index}`).join(','))).toHaveLength(
      21,
    );
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

  it('4つの便利系Commandを重複なく定義する', () => {
    const names = coreFunUtilityCommands.map((command) => command.definition.name);
    expect(names).toEqual(['choose', 'dice', 'coinflip', 'random']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('chooseとrandomの必須入力を定義する', () => {
    const choose = coreFunUtilityCommands.find((command) => command.definition.name === 'choose');
    const random = coreFunUtilityCommands.find((command) => command.definition.name === 'random');

    expect(choose?.definition.options?.[0]).toMatchObject({
      name: 'choices',
      type: 'string',
      required: true,
    });
    expect(random?.definition.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'min', type: 'integer', required: true }),
        expect.objectContaining({ name: 'max', type: 'integer', required: true }),
      ]),
    );
  });
});
