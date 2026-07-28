import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_RESPONSE_CONFIG,
  AutoResponseValidationError,
  assertSafeRegex,
  matchesAutoResponse,
  normalizeAutoResponseConfig,
  normalizeAutoResponseRuleInput,
  parseAutoResponseEmbed,
} from './config.js';

describe('Auto Response config', () => {
  it('空設定へ安全な既定値を適用する', () => {
    expect(normalizeAutoResponseConfig({})).toEqual(DEFAULT_AUTO_RESPONSE_CONFIG);
  });

  it('数値を許容範囲へ丸める', () => {
    expect(
      normalizeAutoResponseConfig({
        maxRules: 9999,
        maxRulesPerMessage: 0,
        guildCooldownSeconds: -1,
        regexExecutionBudgetMs: 999,
      }),
    ).toMatchObject({
      maxRules: 200,
      maxRulesPerMessage: 1,
      guildCooldownSeconds: 0,
      regexExecutionBudgetMs: 50,
    });
  });
});

describe('Auto Response rule validation', () => {
  it('スコープIDを正規化して重複排除する', () => {
    const rule = normalizeAutoResponseRuleInput(
      {
        name: 'Greeting',
        triggerValue: 'hello',
        matchMode: 'exact',
        responseType: 'text',
        responseContent: 'こんにちは',
        channelIds: [' 123 ', '123', '456'],
        roleIds: ['789'],
      },
      DEFAULT_AUTO_RESPONSE_CONFIG,
    );
    expect(rule.channelIds).toEqual(['123', '456']);
    expect(rule.roleIds).toEqual(['789']);
    expect(rule.cooldownSeconds).toBe(DEFAULT_AUTO_RESPONSE_CONFIG.defaultRuleCooldownSeconds);
  });

  it('everyone・here・ロールメンションを拒否する', () => {
    for (const responseContent of ['@everyone', '@here', '<@&123>']) {
      expect(() =>
        normalizeAutoResponseRuleInput(
          {
            name: 'Blocked mention',
            triggerValue: 'hello',
            matchMode: 'partial',
            responseType: 'text',
            responseContent,
          },
          DEFAULT_AUTO_RESPONSE_CONFIG,
        ),
      ).toThrow(AutoResponseValidationError);
    }
  });

  it('Embed JSONを許可されたフィールドだけに正規化する', () => {
    expect(
      parseAutoResponseEmbed(
        JSON.stringify({
          title: 'お知らせ',
          description: '本文',
          color: 0x5865f2,
          fields: [{ name: '項目', value: '内容', inline: true }],
        }),
      ),
    ).toEqual({
      title: 'お知らせ',
      description: '本文',
      color: 0x5865f2,
      fields: [{ name: '項目', value: '内容', inline: true }],
    });
  });
});

describe('Auto Response matcher', () => {
  it('exact・partial・prefixを大文字小文字を無視して評価する', () => {
    const config = DEFAULT_AUTO_RESPONSE_CONFIG;
    expect(
      matchesAutoResponse(
        'Hello',
        { triggerValue: 'hello', matchMode: 'exact', caseSensitive: false },
        config,
      ),
    ).toBe(true);
    expect(
      matchesAutoResponse(
        'Say HELLO!',
        { triggerValue: 'hello', matchMode: 'partial', caseSensitive: false },
        config,
      ),
    ).toBe(true);
    expect(
      matchesAutoResponse(
        'Hello world',
        { triggerValue: 'hello', matchMode: 'prefix', caseSensitive: false },
        config,
      ),
    ).toBe(true);
  });

  it('安全な正規表現を評価する', () => {
    expect(
      matchesAutoResponse(
        'hello-123',
        { triggerValue: '^hello-\\d+$', matchMode: 'regex', caseSensitive: false },
        DEFAULT_AUTO_RESPONSE_CONFIG,
      ),
    ).toBe(true);
  });

  it('ネスト量指定・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of ['(a+)+$', '(a)\\1', '.*foo.*bar.*']) {
      expect(() => assertSafeRegex(pattern, 100)).toThrow(AutoResponseValidationError);
    }
  });

  it('巨大メッセージを評価対象外にする', () => {
    const config = { ...DEFAULT_AUTO_RESPONSE_CONFIG, maxMessageLength: 5 };
    expect(
      matchesAutoResponse(
        '123456',
        { triggerValue: '1', matchMode: 'partial', caseSensitive: false },
        config,
      ),
    ).toBe(false);
  });
});
