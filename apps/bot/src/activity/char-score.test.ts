import { describe, expect, it } from 'vitest';
import { charScoreUnitsToPoints, computeCharScoreUnits } from './char-score.js';

describe('computeCharScoreUnits', () => {
  it('半角文字は1unit(0.5pt相当)として数える', () => {
    expect(computeCharScoreUnits('abc')).toBe(3);
  });

  it('全角文字(日本語)は2unit(1pt相当)として数える', () => {
    expect(computeCharScoreUnits('あいう')).toBe(6);
  });

  it('半角・全角混在を正しく合算する', () => {
    expect(computeCharScoreUnits('aあ')).toBe(1 + 2);
  });

  it('空白(半角・全角スペース、改行、タブ)は集計から除外する', () => {
    expect(computeCharScoreUnits('a b\nc\t　d')).toBe(4);
  });

  it('URLは集計から除外する', () => {
    expect(computeCharScoreUnits('見て https://example.com/path?x=1 すごい')).toBe(
      computeCharScoreUnits('見て  すごい'),
    );
  });

  it('Discordカスタム絵文字は集計から除外する', () => {
    expect(computeCharScoreUnits('<:herta:123456789012345678>')).toBe(0);
    expect(computeCharScoreUnits('やったー<a:party:123456789012345678>')).toBe(
      computeCharScoreUnits('やったー'),
    );
  });

  it('Unicode絵文字は集計から除外する', () => {
    expect(computeCharScoreUnits('🎉🎉🎉')).toBe(0);
    expect(computeCharScoreUnits('最高🎉')).toBe(computeCharScoreUnits('最高'));
  });

  it('空文字列は0を返す', () => {
    expect(computeCharScoreUnits('')).toBe(0);
  });
});

describe('charScoreUnitsToPoints', () => {
  it('unitを2で割ってptへ変換する', () => {
    expect(charScoreUnitsToPoints(3)).toBe(1.5);
    expect(charScoreUnitsToPoints(6)).toBe(3);
    expect(charScoreUnitsToPoints(0)).toBe(0);
  });

  it('小数第1位までに丸める', () => {
    expect(charScoreUnitsToPoints(7)).toBe(3.5);
  });
});
