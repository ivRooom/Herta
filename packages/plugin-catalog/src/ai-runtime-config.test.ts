import { describe, expect, it, vi } from 'vitest';
import {
  AiRuntimeConfigurationResolver,
  type AiRuntimeConfigurationResolverOptions,
} from './ai-runtime-config.js';

type ConfigurationReader = NonNullable<AiRuntimeConfigurationResolverOptions['readConfiguration']>;

const prisma = {} as AiRuntimeConfigurationResolverOptions['prisma'];

function record(value: Record<string, unknown>, updatedAt = new Date('2026-08-27T00:00:00Z')) {
  return {
    name: 'ai.runtime' as const,
    value,
    updatedBy: 'admin-1',
    updatedAt,
  };
}

describe('AiRuntimeConfigurationResolver', () => {
  it('valid console settingをenv defaultより優先する', async () => {
    const readConfiguration = vi.fn<ConfigurationReader>().mockResolvedValue(
      record({ provider: 'openai', modelProfile: 'economy', reasoningEffort: 'medium' }),
    );
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {
        HERTA_AI_PROVIDER: 'openai',
        HERTA_AI_MODEL_PROFILE: 'quality',
        HERTA_AI_REASONING_EFFORT: 'high',
      },
      readConfiguration,
    });

    await expect(resolver.resolve()).resolves.toMatchObject({
      source: 'console',
      storeAvailable: true,
      value: { provider: 'openai', modelProfile: 'economy', reasoningEffort: 'medium' },
      selection: { model: 'gpt-5.6-luna' },
    });
  });

  it('store未登録時はallowlisted env defaultへfallbackする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {
        HERTA_AI_PROVIDER: 'openai',
        HERTA_AI_MODEL_PROFILE: 'quality',
        HERTA_AI_REASONING_EFFORT: 'xhigh',
      },
      readConfiguration: vi.fn<ConfigurationReader>().mockResolvedValue(null),
    });

    await expect(resolver.resolve()).resolves.toMatchObject({
      source: 'environment',
      storeAvailable: true,
      value: { provider: 'openai', modelProfile: 'quality', reasoningEffort: 'xhigh' },
      selection: { model: 'gpt-5.6-sol' },
    });
  });

  it('store read failureはnon-secret allowlisted env/defaultへsafe fallbackする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      readConfiguration: vi
        .fn<ConfigurationReader>()
        .mockRejectedValue(new Error('db unavailable')),
    });

    await expect(resolver.resolve()).resolves.toMatchObject({
      source: 'default',
      storeAvailable: false,
      value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' },
    });
  });

  it('persisted invalid settingはsilently downgradeせずfail closedする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: { HERTA_AI_MODEL_PROFILE: 'balanced' },
      readConfiguration: vi.fn<ConfigurationReader>().mockResolvedValue(
        record({ provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'turbo' }),
      ),
    });

    await expect(resolver.resolve()).rejects.toMatchObject({ code: 'invalid_reasoning_effort' });
  });

  it('TTL内は同一snapshotを返しTTL経過後にstoreを再読込する', async () => {
    let now = 1_000;
    const readConfiguration = vi
      .fn<ConfigurationReader>()
      .mockResolvedValueOnce(
        record({ provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' }),
      )
      .mockResolvedValueOnce(
        record({ provider: 'openai', modelProfile: 'economy', reasoningEffort: 'high' }),
      );
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      ttlMs: 5_000,
      now: () => now,
      readConfiguration,
      env: {},
    });

    expect((await resolver.resolve()).selection.model).toBe('gpt-5.6-terra');
    now = 5_999;
    expect((await resolver.resolve()).selection.model).toBe('gpt-5.6-terra');
    expect(readConfiguration).toHaveBeenCalledTimes(1);

    now = 6_000;
    expect((await resolver.resolve()).selection.model).toBe('gpt-5.6-luna');
    expect(readConfiguration).toHaveBeenCalledTimes(2);
  });
});
