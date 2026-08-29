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
  it('hard-coded safe defaultはOpenAI balanced/low', () => {
    expect(AI_RUNTIME_SAFE_DEFAULT).toEqual({
      provider: 'openai',
      modelProfile: 'balanced',
      reasoningEffort: 'low',
    });
    expect(resolveAiRuntimeSelection(AI_RUNTIME_SAFE_DEFAULT)).toMatchObject({
      provider: 'openai',
      modelProfile: 'balanced',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low',
    });
  });

  it('arbitrary provider/profile/reasoningを拒否する', () => {
    for (const value of [
      { provider: 'anthropic', modelProfile: 'balanced', reasoningEffort: 'low' },
      { provider: 'openai', modelProfile: 'custom', reasoningEffort: 'low' },
      { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'turbo' },
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
      }),
    ).toEqual({ provider: 'openai', modelProfile: 'quality', reasoningEffort: 'high' });
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
    ]);
  });
});
