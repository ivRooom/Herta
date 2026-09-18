import { RuntimeConfigurationError } from '@herta/db';
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
      record({
        provider: 'openai',
        modelProfile: 'economy',
        reasoningEffort: 'medium',
        timezone: 'Asia/Tokyo',
      }),
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
      value: {
        provider: 'openai',
        modelProfile: 'economy',
        reasoningEffort: 'medium',
        timezone: 'Asia/Tokyo',
      },
      selection: { model: 'gpt-5.6-luna' },
    });
  });

  it('valid console settingはinvalid env defaultより優先する', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: { HERTA_AI_PROVIDER: 'unsupported' },
      readConfiguration: vi.fn<ConfigurationReader>().mockResolvedValue(
        record({
          provider: 'openai',
          modelProfile: 'balanced',
          reasoningEffort: 'low',
          timezone: 'Asia/Tokyo',
        }),
      ),
    });

    await expect(resolver.resolve()).resolves.toMatchObject({
      source: 'console',
      value: {
        provider: 'openai',
        modelProfile: 'balanced',
        reasoningEffort: 'low',
        timezone: 'Asia/Tokyo',
      },
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

  it('persisted storage validation errorはfallbackせずfail closedする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      readConfiguration: vi
        .fn<ConfigurationReader>()
        .mockRejectedValue(new RuntimeConfigurationError('invalid_value')),
    });

    await expect(resolver.resolve()).rejects.toMatchObject({ code: 'invalid_value' });
  });

  it('persisted invalid settingはsilently downgradeせずfail closedする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: { HERTA_AI_MODEL_PROFILE: 'balanced' },
      readConfiguration: vi.fn<ConfigurationReader>().mockResolvedValue(
        record({
          provider: 'openai',
          modelProfile: 'balanced',
          reasoningEffort: 'turbo',
          timezone: 'Asia/Tokyo',
        }),
      ),
    });

    await expect(resolver.resolve()).rejects.toMatchObject({ code: 'invalid_reasoning_effort' });
  });

  it('persisted invalid timezoneはsilently downgradeせずfail closedする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      readConfiguration: vi.fn<ConfigurationReader>().mockResolvedValue(
        record({
          provider: 'openai',
          modelProfile: 'balanced',
          reasoningEffort: 'low',
          timezone: 'Not/A_Timezone',
        }),
      ),
    });

    await expect(resolver.resolve()).rejects.toMatchObject({ code: 'invalid_timezone' });
  });

  it('TTL内は同一snapshotを返しTTL経過後にstoreを再読込する', async () => {
    let now = 1_000;
    const readConfiguration = vi
      .fn<ConfigurationReader>()
      .mockResolvedValueOnce(
        record({
          provider: 'openai',
          modelProfile: 'balanced',
          reasoningEffort: 'low',
          timezone: 'Asia/Tokyo',
        }),
      )
      .mockResolvedValueOnce(
        record({
          provider: 'openai',
          modelProfile: 'economy',
          reasoningEffort: 'high',
          timezone: 'Asia/Tokyo',
        }),
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
