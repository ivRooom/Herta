import { RuntimeSecretError, readRuntimeSecret } from '@herta/db';
import type { RedisEvalClient } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it } from 'vitest';
import { createAiFoundationRuntime, resolveAiOpenAiCredential } from './factory.js';

const prisma = {} as Parameters<typeof readRuntimeSecret>[0];
const redis: RedisEvalClient = {
  eval: async () => 1,
};

describe('AI Foundation Bot credential bootstrap', () => {
  it('runtime secretをenv fallbackより優先する', async () => {
    const result = await resolveAiOpenAiCredential({
      prisma,
      env: { OPENAI_API_KEY: 'env-key' },
      readSecret: async () => 'stored-key',
    });
    expect(result).toEqual({ apiKey: 'stored-key', source: 'runtime_secret', failure: null });
  });

  it('runtime secret未登録時だけOPENAI_API_KEY fallbackを使う', async () => {
    const result = await resolveAiOpenAiCredential({
      prisma,
      env: { OPENAI_API_KEY: 'env-key' },
      readSecret: async () => null,
    });
    expect(result).toEqual({ apiKey: 'env-key', source: 'environment', failure: null });
  });

  it('master key/decrypt failureはenv fallbackへ逃がさずfail closedする', async () => {
    const result = await resolveAiOpenAiCredential({
      prisma,
      env: { OPENAI_API_KEY: 'env-key' },
      readSecret: async () => {
        throw new RuntimeSecretError('decrypt_failed');
      },
    });
    expect(result).toEqual({ apiKey: null, source: null, failure: 'decrypt_failed' });
  });

  it('DB unavailable時もenv fallbackへ逃がさずfail closedする', async () => {
    const result = await resolveAiOpenAiCredential({
      prisma,
      env: { OPENAI_API_KEY: 'env-key' },
      readSecret: async () => {
        throw new Error('database unavailable');
      },
    });
    expect(result).toEqual({
      apiKey: null,
      source: null,
      failure: 'runtime_secret_unavailable',
    });
  });

  it('AI既定OFFならcredentialを読まずBotを壊さない', async () => {
    const result = await createAiFoundationRuntime({
      prisma,
      redis,
      env: {},
      readSecret: async () => {
        throw new Error('must not read credential while disabled');
      },
    });
    expect(result).toEqual({ service: null, status: 'disabled', credentialSource: null });
  });

  it('AI ONかつcredentialありでserviceを構築する', async () => {
    const result = await createAiFoundationRuntime({
      prisma,
      redis,
      env: { HERTA_AI_ENABLED: 'true' },
      readSecret: async () => 'stored-key',
    });
    expect(result.status).toBe('ready');
    expect(result.credentialSource).toBe('runtime_secret');
    expect(result.service).not.toBeNull();
  });
});
