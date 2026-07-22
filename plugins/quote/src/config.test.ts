import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUOTE_CONFIG,
  MAX_QUOTE_LENGTH,
  QuoteValidationError,
  normalizeQuoteConfig,
  parseQuoteTags,
  validateQuoteText,
} from './config.js';

describe('Quote config', () => {
  it('空設定へ安全な既定値を適用する', () => {
    expect(normalizeQuoteConfig({})).toEqual(DEFAULT_QUOTE_CONFIG);
  });

  it('最大文字数を許容範囲へ丸め、Channel IDを正規化する', () => {
    expect(
      normalizeQuoteConfig({
        maxQuoteLength: 99999,
        allowedChannelIds: [' 123 ', '123', 'invalid', 456],
      }),
    ).toMatchObject({
      maxQuoteLength: MAX_QUOTE_LENGTH,
      allowedChannelIds: ['123'],
    });
  });
});

describe('Quote input validation', () => {
  it('タグを小文字化・重複排除する', () => {
    expect(parseQuoteTags(' Herta, bot,herta ')).toEqual(['herta', 'bot']);
  });

  it('空本文と上限超過を拒否する', () => {
    expect(() => validateQuoteText('   ')).toThrow(QuoteValidationError);
    expect(() => validateQuoteText('1234', 3)).toThrow('名言本文は3文字以内で入力してください');
  });

  it('タグ件数上限を超えた入力を拒否する', () => {
    expect(() => parseQuoteTags('a,b,c,d,e,f')).toThrow('タグは最大5件まで指定できます');
  });
});
