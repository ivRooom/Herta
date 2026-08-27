import type { RuntimeConfigurationRecord } from '@herta/db';
import {
  resolveAiFoundationConfig,
  type AiGenerationRequest,
  type AiGuardStore,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiRuntimeGenerationService } from './runtime-service.js';

const request: AiGenerationRequest = {
  feature: 'runtime.test',
  input: 'hello',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

const prisma = {} as ConstructorParameters<typeof AiRuntimeConfigurationResolver>[0]['prisma'];

function guardStore(): AiGuardStore {
  return {
    consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
    reserveGuildQuota: async () => ({ allowed: true, retryAfterMs: 0 }),
    settleGuildQuota: async (_guildKey, _requestId, actualMicroUsd) => actualMicroUsd,
    acquireConcurrency: async () => true,
    releaseConcurrency: async () => undefined,
  };
}

function stored(
  modelProfile: 'quality' | 'balanced' | 'economy',
  reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
): RuntimeConfigurationRecord {
  return {
    name: 'ai.runtime',
    value: { provider: 'openai', modelProfile, reasoningEffort },
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-08-27T00:00:00Z'),
  };
}

describe('OpenAiRuntimeGenerationService', () => {
  it('resolved model/reasoningを同一request snapshotへ適用しcost guardもmodelに追随する', async () => {
    const readConfiguration = vi
      .fn()
      .mockResolvedValueOnce(stored('balanced', 'high'))
      .mockResolvedValueOnce(stored('economy', 'none'));
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      ttlMs: 0,
      readConfiguration,
    });
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
    };
    const service = new OpenAiRuntimeGenerationService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver,
      fetchImpl,
    });

    const balanced = await service.generate(request);
    const economy = await service.generate({ ...request, userId: 'user-2' });

    expect(bodies[0]).toMatchObject({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'high' },
    });
    expect(balanced.model).toBe('gpt-5.6-terra');
    expect(balanced.estimatedCost).toBe(0.00008);

    expect(bodies[1]).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoning: { effort: 'none' },
    });
    expect(economy.model).toBe('gpt-5.6-luna');
    expect(economy.estimatedCost).toBe(0.000008);
  });

  it('invalid persisted runtime settingはprovider call前にfail closedする', async () => {
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      ttlMs: 0,
      readConfiguration: vi.fn().mockResolvedValue({
        ...stored('balanced', 'low'),
        value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'turbo' },
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new OpenAiRuntimeGenerationService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver,
      fetchImpl,
    });

    await expect(service.generate(request)).rejects.toMatchObject({ category: 'internal_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
