import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  coreUtilityV4Commands,
  decodeBase64,
  decodeUrlComponent,
  encodeBase64,
  encodeUrlComponent,
  parseColor,
} from './utility-v4.js';

describe('Core Utility v4', () => {
  it('4つのCommandを重複なく定義する', () => {
    const names = coreUtilityV4Commands.map((command) => command.definition.name);
    expect(names).toEqual(['color', 'base64', 'url', 'textstats']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('HEXとRGBを正規化する', () => {
    expect(parseColor('#7c6df2')).toEqual({
      hex: '#7C6DF2',
      rgb: { r: 124, g: 109, b: 242 },
      decimal: 8_154_610,
    });
    expect(parseColor('rgb(124, 109, 242)')?.hex).toBe('#7C6DF2');
    expect(parseColor('rgb(256,0,0)')).toBeNull();
    expect(parseColor('#xyzxyz')).toBeNull();
  });

  it('UTF-8テキストをBase64で往復できる', () => {
    const encoded = encodeBase64('Herta テスト');
    expect(decodeBase64(encoded)).toBe('Herta テスト');
    expect(decodeBase64('%%%')).toBeNull();
    expect(decodeBase64('////')).toBeNull();
  });

  it('URL componentを安全に往復し、不正escapeを拒否する', () => {
    const encoded = encodeUrlComponent('Herta 日本語 / test');
    expect(decodeUrlComponent(encoded)).toBe('Herta 日本語 / test');
    expect(decodeUrlComponent('%E0%A4%A')).toBeNull();
  });

  it('Unicode code point・行数・単語数・UTF-8 byte数を集計する', () => {
    expect(analyzeText('A😀 B\n日本語')).toEqual({
      characters: 9,
      codePoints: 8,
      lines: 2,
      words: 3,
      utf8Bytes: 15,
    });
  });

  it('必須Optionを定義する', () => {
    for (const command of coreUtilityV4Commands) {
      expect(command.definition.options?.some((option) => option.required)).toBe(true);
    }
  });
});
