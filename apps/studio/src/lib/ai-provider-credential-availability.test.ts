import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAnthropicProviderCredentialAvailability,
  resolveOpenAiProviderCredentialAvailability,
} from './ai-provider-credential-availability.ts';

test('readable Runtime Secret makes OpenAI available without using env fallback', async () => {
  let reads = 0;
  const result = await resolveOpenAiProviderCredentialAvailability({
    readRuntimeCredential: async () => {
      reads += 1;
      return 'runtime-secret-value';
    },
    environmentCredential: 'environment-secret-value',
  });

  assert.equal(reads, 1);
  assert.deepEqual(result, {
    provider: 'openai',
    available: true,
    source: 'runtime_secret',
    status: 'ready',
  });
});

test('missing Runtime Secret can use the legacy environment fallback', async () => {
  const result = await resolveOpenAiProviderCredentialAvailability({
    readRuntimeCredential: async () => null,
    environmentCredential: ' environment-secret-value ',
  });

  assert.deepEqual(result, {
    provider: 'openai',
    available: true,
    source: 'environment',
    status: 'ready',
  });
});

test('Runtime Secret Store failure stays fail closed even when env fallback exists', async () => {
  const result = await resolveOpenAiProviderCredentialAvailability({
    readRuntimeCredential: async () => {
      throw new Error('store unavailable');
    },
    environmentCredential: 'environment-secret-value',
  });

  assert.deepEqual(result, {
    provider: 'openai',
    available: false,
    source: null,
    status: 'credential_store_unavailable',
  });
});

test('OpenAI is unavailable when neither credential source is usable', async () => {
  const result = await resolveOpenAiProviderCredentialAvailability({
    readRuntimeCredential: async () => null,
    environmentCredential: '   ',
  });

  assert.deepEqual(result, {
    provider: 'openai',
    available: false,
    source: null,
    status: 'missing_credential',
  });
});

test('readable Runtime Secret makes Anthropic available without using env fallback', async () => {
  let reads = 0;
  const result = await resolveAnthropicProviderCredentialAvailability({
    readRuntimeCredential: async () => {
      reads += 1;
      return 'runtime-secret-value';
    },
    environmentCredential: 'environment-secret-value',
  });

  assert.equal(reads, 1);
  assert.deepEqual(result, {
    provider: 'anthropic',
    available: true,
    source: 'runtime_secret',
    status: 'ready',
  });
});

test('missing Anthropic Runtime Secret can use the legacy environment fallback', async () => {
  const result = await resolveAnthropicProviderCredentialAvailability({
    readRuntimeCredential: async () => null,
    environmentCredential: ' environment-secret-value ',
  });

  assert.deepEqual(result, {
    provider: 'anthropic',
    available: true,
    source: 'environment',
    status: 'ready',
  });
});

test('Anthropic Runtime Secret Store failure stays fail closed even when env fallback exists', async () => {
  const result = await resolveAnthropicProviderCredentialAvailability({
    readRuntimeCredential: async () => {
      throw new Error('store unavailable');
    },
    environmentCredential: 'environment-secret-value',
  });

  assert.deepEqual(result, {
    provider: 'anthropic',
    available: false,
    source: null,
    status: 'credential_store_unavailable',
  });
});

test('Anthropic is unavailable when neither credential source is usable', async () => {
  const result = await resolveAnthropicProviderCredentialAvailability({
    readRuntimeCredential: async () => null,
    environmentCredential: '   ',
  });

  assert.deepEqual(result, {
    provider: 'anthropic',
    available: false,
    source: null,
    status: 'missing_credential',
  });
});
