import { describe, expect, it } from 'vitest';
import {
  AI_RUNTIME_SAFE_DEFAULT,
  AiRuntimePolicyError,
  getAiProviderCapabilities,
  getAiRuntimePolicyMetadata,
  isAiProviderCapabilityEnabled,
  parseAiRuntimeStoredValue,
  resolveAiRuntimeEnvDefault,
  resolveAiRuntimeSelection,
} from './ai-runtime-policy.js';

describe('AI runtime policy', () => {
  it('hard-coded safe defaultはOpenAI balanced/low/Asia-Tokyo', () => {
    expect(AI_RUNTIME_SAFE_DEFAULT).toEqual({
      provider: 'openai',
      modelProfile: 'balanced',
      reasoningEffort: 'low',
      timezone: 'Asia/Tokyo',
    });
    expect(resolveAiRuntimeSelection(AI_RUNTIME_SAFE_DEFAULT)).toMatchObject({
      provider: 'openai',
      modelProfile: 'balanced',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low',
      timezone: 'Asia/Tokyo',
    });
  });

  it('timezone追加以前に保存された3フィールドのstored valueを後方互換で受け付ける', () => {
    expect(
      parseAiRuntimeStoredValue({
        provider: 'openai',
        modelProfile: 'economy',
        reasoningEffort: 'medium',
      }),
    ).toEqual({
      provider: 'openai',
      modelProfile: 'economy',
      reasoningEffort: 'medium',
      timezone: 'Asia/Tokyo',
    });
  });

  it('arbitrary provider/profile/reasoning/timezoneを拒否する', () => {
    for (const value of [
      { provider: 'other', modelProfile: 'balanced', reasoningEffort: 'low', timezone: 'UTC' },
      { provider: 'openai', modelProfile: 'custom', reasoningEffort: 'low', timezone: 'UTC' },
      { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'turbo', timezone: 'UTC' },
      {
        provider: 'openai',
        modelProfile: 'balanced',
        reasoningEffort: 'low',
        timezone: 'Not/A_Timezone',
      },
    ]) {
      expect(() => parseAiRuntimeStoredValue(value)).toThrowError(AiRuntimePolicyError);
    }
  });

  it('余分なmodel ID等を含むstored valueを拒否する', () => {
    expect(() =>
      parseAiRuntimeStoredValue({
        provider: 'openai',
        modelProfile: 'balanced',
        reasoningEffort: 'low',
        model: 'client-selected-model',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AiRuntimePolicyError>>({ code: 'invalid_shape' }),
    );
  });

  it('allowlisted env defaultを解決する', () => {
    expect(
      resolveAiRuntimeEnvDefault({
        HERTA_AI_PROVIDER: ' OPENAI ',
        HERTA_AI_MODEL_PROFILE: 'QUALITY',
        HERTA_AI_REASONING_EFFORT: 'HIGH',
        HERTA_AI_TIMEZONE: ' America/New_York ',
      }),
    ).toEqual({
      provider: 'openai',
      modelProfile: 'quality',
      reasoningEffort: 'high',
      timezone: 'America/New_York',
    });
  });

  it('HERTA_AI_TIMEZONEは大文字小文字を保持する(IANA名はcase-sensitive)', () => {
    expect(resolveAiRuntimeEnvDefault({ HERTA_AI_TIMEZONE: 'Asia/Tokyo' }).timezone).toBe(
      'Asia/Tokyo',
    );
  });

  it('不正なHERTA_AI_TIMEZONEはfail closedする', () => {
    expect(() => resolveAiRuntimeEnvDefault({ HERTA_AI_TIMEZONE: 'Not/A_Timezone' })).toThrowError(
      expect.objectContaining<Partial<AiRuntimePolicyError>>({ code: 'invalid_timezone' }),
    );
  });

  it('env未設定時はhard-coded safe defaultへ解決する', () => {
    expect(resolveAiRuntimeEnvDefault({})).toEqual(AI_RUNTIME_SAFE_DEFAULT);
  });

  it('provider tool capabilityはserver-side allowlistをSoTにする', () => {
    expect(getAiProviderCapabilities('openai')).toEqual([
      'text',
      'code_interpreter',
      'image_generation',
    ]);
    expect(isAiProviderCapabilityEnabled('openai', 'text')).toBe(true);
    expect(isAiProviderCapabilityEnabled('openai', 'code_interpreter')).toBe(true);
    expect(isAiProviderCapabilityEnabled('openai', 'image_generation')).toBe(true);

    expect(getAiProviderCapabilities('anthropic')).toEqual(['text']);
    expect(isAiProviderCapabilityEnabled('anthropic', 'text')).toBe(true);
    expect(isAiProviderCapabilityEnabled('anthropic', 'code_interpreter')).toBe(false);
    expect(isAiProviderCapabilityEnabled('anthropic', 'image_generation')).toBe(false);
  });

  it('metadataはclientへarbitrary model/tool入力欄を作らずserver allowlistを返す', () => {
    expect(getAiRuntimePolicyMetadata()).toEqual([
      {
        provider: 'openai',
        capabilities: ['text', 'code_interpreter', 'image_generation'],
        profiles: [
          expect.objectContaining({
            modelProfile: 'quality',
            model: 'gpt-5.6-sol',
            supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          }),
          expect.objectContaining({ modelProfile: 'balanced', model: 'gpt-5.6-terra' }),
          expect.objectContaining({ modelProfile: 'economy', model: 'gpt-5.6-luna' }),
        ],
      },
      {
        provider: 'anthropic',
        capabilities: ['text'],
        profiles: [
          expect.objectContaining({
            modelProfile: 'quality',
            model: 'claude-opus-5',
            supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          }),
          expect.objectContaining({
            modelProfile: 'balanced',
            model: 'claude-sonnet-5',
            supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          }),
          expect.objectContaining({
            modelProfile: 'economy',
            model: 'claude-haiku-4-5-20251001',
            supportedReasoningEfforts: ['none'],
          }),
        ],
      },
    ]);
  });

  it('Anthropic quality/balancedはfull effort rangeをbalanced/economyへ渡さない', () => {
    expect(() =>
      resolveAiRuntimeSelection({
        provider: 'anthropic',
        modelProfile: 'quality',
        reasoningEffort: 'none',
        timezone: 'UTC',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AiRuntimePolicyError>>({ code: 'unsupported_combination' }),
    );

    expect(
      resolveAiRuntimeSelection({
        provider: 'anthropic',
        modelProfile: 'quality',
        reasoningEffort: 'xhigh',
        timezone: 'UTC',
      }),
    ).toMatchObject({ model: 'claude-opus-5', reasoningEffort: 'xhigh' });
  });

  it('Claude Haiku 4.5 (economy)は"none"以外のreasoning effortを拒否する', () => {
    for (const reasoningEffort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(() =>
        resolveAiRuntimeSelection({
          provider: 'anthropic',
          modelProfile: 'economy',
          reasoningEffort,
          timezone: 'UTC',
        }),
      ).toThrowError(
        expect.objectContaining<Partial<AiRuntimePolicyError>>({
          code: 'unsupported_combination',
        }),
      );
    }

    expect(
      resolveAiRuntimeSelection({
        provider: 'anthropic',
        modelProfile: 'economy',
        reasoningEffort: 'none',
        timezone: 'UTC',
      }),
    ).toMatchObject({ model: 'claude-haiku-4-5-20251001', reasoningEffort: 'none' });
  });
});
