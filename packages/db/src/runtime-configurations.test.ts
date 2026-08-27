import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_RUNTIME_CONFIGURATION,
  RuntimeConfigurationError,
  validateRuntimeConfigurationName,
  validateRuntimeConfigurationValue,
} from './runtime-configurations.js';

test('allowlisted global runtime configuration nameだけを許可する', () => {
  assert.equal(validateRuntimeConfigurationName(AI_RUNTIME_CONFIGURATION), 'ai.runtime');
  assert.throws(
    () => validateRuntimeConfigurationName('arbitrary.runtime'),
    (error: unknown) => error instanceof RuntimeConfigurationError && error.code === 'invalid_name',
  );
});

test('object valueを許可する', () => {
  assert.deepEqual(
    validateRuntimeConfigurationValue({
      provider: 'openai',
      modelProfile: 'balanced',
      reasoningEffort: 'low',
    }),
    {
      provider: 'openai',
      modelProfile: 'balanced',
      reasoningEffort: 'low',
    },
  );
});

test('secret-like keyをruntime configurationへ保存させない', () => {
  for (const value of [
    { apiKey: 'secret' },
    { nested: { api_key: 'secret' } },
    { credential: 'secret' },
    { accessToken: 'secret' },
    { password: 'secret' },
  ]) {
    assert.throws(
      () => validateRuntimeConfigurationValue(value),
      (error: unknown) =>
        error instanceof RuntimeConfigurationError && error.code === 'invalid_value',
    );
  }
});

test('oversized valueを拒否する', () => {
  assert.throws(
    () => validateRuntimeConfigurationValue({ payload: 'a'.repeat(20 * 1024) }),
    (error: unknown) =>
      error instanceof RuntimeConfigurationError && error.code === 'invalid_value',
  );
});
