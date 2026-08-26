import { describe, expect, it } from 'vitest';
import {
  AI_RUNTIME_CONFIGURATION,
  RuntimeConfigurationError,
  validateRuntimeConfigurationName,
  validateRuntimeConfigurationValue,
} from './runtime-configurations.js';

describe('runtime configurations', () => {
  it('allowlisted global runtime configuration nameだけを許可する', () => {
    expect(validateRuntimeConfigurationName(AI_RUNTIME_CONFIGURATION)).toBe('ai.runtime');
    expect(() => validateRuntimeConfigurationName('arbitrary.runtime')).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigurationError>>({ code: 'invalid_name' }),
    );
  });

  it('object valueを許可する', () => {
    expect(
      validateRuntimeConfigurationValue({
        provider: 'openai',
        modelProfile: 'balanced',
        reasoningEffort: 'low',
      }),
    ).toEqual({
      provider: 'openai',
      modelProfile: 'balanced',
      reasoningEffort: 'low',
    });
  });

  it('secret-like keyをruntime configurationへ保存させない', () => {
    for (const value of [
      { apiKey: 'secret' },
      { nested: { api_key: 'secret' } },
      { credential: 'secret' },
      { accessToken: 'secret' },
      { password: 'secret' },
    ]) {
      expect(() => validateRuntimeConfigurationValue(value)).toThrowError(
        expect.objectContaining<Partial<RuntimeConfigurationError>>({ code: 'invalid_value' }),
      );
    }
  });

  it('oversized valueを拒否する', () => {
    expect(() =>
      validateRuntimeConfigurationValue({ payload: 'a'.repeat(20 * 1024) }),
    ).toThrowError(expect.objectContaining<Partial<RuntimeConfigurationError>>({ code: 'invalid_value' }));
  });
});
