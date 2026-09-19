import { describe, expect, it } from 'vitest';
import {
  isJmaWeatherQuery,
  listJmaAreaNames,
  resolveJmaAreaFromText,
} from './jma-weather-policy.js';

describe('JMA weather policy', () => {
  it('天気関連のキーワードを検知する', () => {
    expect(isJmaWeatherQuery('今日の東京の天気は？')).toBe(true);
    expect(isJmaWeatherQuery('明日の気温を教えて')).toBe(true);
    expect(isJmaWeatherQuery('降水確率は？')).toBe(true);
    expect(isJmaWeatherQuery('weather in Tokyo')).toBe(true);
  });

  it('天気と無関係な文章は検知しない', () => {
    expect(isJmaWeatherQuery('ReactとVueを比較して')).toBe(false);
    expect(isJmaWeatherQuery('FizzBuzzを書いて')).toBe(false);
  });

  it('allowlistされた地名から正しいarea entryを解決する', () => {
    expect(resolveJmaAreaFromText('東京の天気は？')).toMatchObject({
      officeCode: '130000',
      amedasStationCode: '44132',
      displayName: '東京',
    });
    expect(resolveJmaAreaFromText('大阪の気温を教えて')).toMatchObject({
      officeCode: '270000',
      displayName: '大阪',
    });
  });

  it('都道府県・市などのaliasを正規化して解決する', () => {
    expect(resolveJmaAreaFromText('東京都の天気')?.displayName).toBe('東京');
    expect(resolveJmaAreaFromText('大阪府の天気')?.displayName).toBe('大阪');
    expect(resolveJmaAreaFromText('京都市の天気')?.displayName).toBe('京都');
    expect(resolveJmaAreaFromText('沖縄の天気')?.displayName).toBe('那覇');
    expect(resolveJmaAreaFromText('神奈川の天気')?.displayName).toBe('横浜');
  });

  it('allowlistにない地名や海外都市は解決しない(fake dataを防ぐ)', () => {
    expect(resolveJmaAreaFromText('ニューヨークの天気は？')).toBeNull();
    expect(resolveJmaAreaFromText('パリの気温は？')).toBeNull();
    expect(resolveJmaAreaFromText('存在しない架空の街の天気')).toBeNull();
  });

  it('任意の文字列をarea codeとして注入できない(allowlist以外は常にnull)', () => {
    expect(resolveJmaAreaFromText('130000')).toBeNull();
    expect(resolveJmaAreaFromText('<script>alert(1)</script>')).toBeNull();
  });

  it('allowlistは空でない主要都市の一覧を返す', () => {
    const names = listJmaAreaNames();
    expect(names).toContain('東京');
    expect(names.length).toBeGreaterThanOrEqual(10);
  });
});
