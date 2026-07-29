import { describe, expect, it } from 'vitest';
import {
  AutoResponseValidationError,
  DEFAULT_AUTO_RESPONSE_CONFIG,
  assertSafeRegex,
  matchesAutoResponse,
  normalizeAutoResponseConfig,
  normalizeAutoResponseRuleInput,
  parseAutoResponseEmbed,
} from './config.js';

describe('Auto Response config', () => {
  it('既定値を適用する', () => {
    expect(normalizeAutoResponseConfig({})).toEqual(DEFAULT_AUTO_RESPONSE_CONFIG);
  });

  it('正規表現の有効化を明示する', () => {
    expect(normalizeAutoResponseConfig({ regexEnabled: true }).regexEnabled).toBe(true);
  });

  it('設定値を許容範囲へ丸める', () => {
    expect(
      normalizeAutoResponseConfig({
        maxRules: 1000,
        maxRulesPerMessage: 99,
        maxRegexEvaluationsPerMessage: 99,
        maxMessageLength: 10,
      }),
    ).toMatchObject({
      maxRules: 200,
      maxRulesPerMessage: 5,
      maxRegexEvaluationsPerMessage: 10,
      maxMessageLength: 100,
    });
  });

  it('旧設定を現行設定へ移行する', () => {
    expect(
      normalizeAutoResponseConfig({
        maxResponses: 3,
        cooldownMs: 12_500,
      }),
    ).toMatchObject({
      maxRules: 3,
      guildCooldownSeconds: 13,
    });
  });
});

describe('Auto Response rule validation', () => {
  const config = DEFAULT_AUTO_RESPONSE_CONFIG;

  it('安全なテキスト応答を正規化する', () => {
    expect(
      normalizeAutoResponseRuleInput(
        {
          name: '  あいさつ  ',
          triggerValue: '  hello  ',
          matchMode: 'exact',
          responseType: 'text',
          responseContent: '  こんにちは  ',
          channelIds: ['123456789012345678', '123456789012345678'],
          roleIds: [],
          cooldownSeconds: 5,
          priority: 10,
          caseSensitive: false,
          enabled: true,
        },
        config,
      ),
    ).toEqual({
      name: 'あいさつ',
      triggerValue: 'hello',
      matchMode: 'exact',
      responseType: 'text',
      responseContent: 'こんにちは',
      channelIds: ['123456789012345678'],
      roleIds: [],
      cooldownSeconds: 5,
      priority: 10,
      caseSensitive: false,
      enabled: true,
    });
  });

  it.each(['@everyone test', '@here test', '<@&123456789012345678> test'])(
    '危険なメンションを拒否する: %s',
    (responseContent) => {
      expect(() =>
        normalizeAutoResponseRuleInput(
          {
            name: 'danger',
            triggerValue: 'test',
            matchMode: 'exact',
            responseType: 'text',
            responseContent,
            channelIds: [],
            roleIds: [],
            cooldownSeconds: 0,
            priority: 0,
            caseSensitive: false,
            enabled: true,
          },
          config,
        ),
      ).toThrow(AutoResponseValidationError);
    },
  );

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
    const config = { ...DEFAULT_AUTO_RESPONSE_CONFIG, regexExecutionBudgetMs: 100 };
    expect(
      matchesAutoResponse(
        'hello-123',
        { triggerValue: '^hello-\\d+$', matchMode: 'regex', caseSensitive: false },
        config,
      ),
    ).toBe(true);
  });

  it('ネスト量指定・曖昧なalternation・後方参照・複数wildcardを拒否する', () => {
    for (const pattern of ['(a+)+$', '(a)\\1', '.*foo.*bar.*', '(a|aa)+$', '(?:a|a)+$']) {
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
