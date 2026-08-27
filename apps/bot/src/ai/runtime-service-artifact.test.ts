import type { RuntimeConfigurationRecord } from '@herta/db';
import {
  resolveAiFoundationConfig,
  type AiGuardStore,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiRuntimeGenerationService } from './runtime-service.js';

const prisma = {} as ConstructorParameters<typeof AiRuntimeConfigurationResolver>[0]['prisma'];

function stored(): RuntimeConfigurationRecord {
  return {
    name: 'ai.runtime',
    value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' },
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-08-27T00:00:00Z'),
  };
}

function guardStore(): AiGuardStore {
  return {
    consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
    reserveGuildQuota: async () => ({ allowed: true, retryAfterMs: 0 }),
    settleGuildQuota: async (_guildKey, _requestId, actual) => actual,
    acquireConcurrency: async () => true,
    releaseConcurrency: async () => undefined,
  };
}

function completedResponse() {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{"artifacts":[]}', annotations: [] }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}

describe('OpenAiRuntimeGenerationService artifact capability instructions', () => {
  it('server-authored artifact instructionをuser inputと分離してproviderへ渡す', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      ttlMs: 0,
      readConfiguration: vi.fn().mockResolvedValue(stored()),
    });
    const service = new OpenAiRuntimeGenerationService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver,
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return completedResponse();
      },
    });
    const userInput = 'PythonでFizzBuzzを書いて';
    const capabilityInstruction =
      'Return exactly one JSON artifact envelope. Do not execute generated code.';

    await service.generate({
      feature: 'ai.artifact',
      input: userInput,
      guildId: 'guild-1',
      scopeGuildId: 'guild-1',
      userId: 'user-1',
      authorized: true,
      pluginEnabled: true,
      guildOptIn: true,
      responseMode: 'artifact',
      groundingState: 'not_required',
      trustedInstructions: [capabilityInstruction],
    });

    expect(bodies[0]?.['input']).toBe(userInput);
    expect(String(bodies[0]?.['instructions'])).toContain(capabilityInstruction);
    expect(String(bodies[0]?.['instructions'])).toContain('Never claim that retrieval');
    expect(String(bodies[0]?.['instructions'])).not.toContain(userInput);
  });

  it('oversized/invalid trusted instructionsはprovider call前にfail closedする', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolver = new AiRuntimeConfigurationResolver({
      prisma,
      env: {},
      ttlMs: 0,
      readConfiguration: vi.fn().mockResolvedValue(stored()),
    });
    const service = new OpenAiRuntimeGenerationService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver,
      fetchImpl,
    });

    await expect(
      service.generate({
        feature: 'ai.artifact',
        input: 'hello',
        guildId: 'guild-1',
        scopeGuildId: 'guild-1',
        userId: 'user-1',
        authorized: true,
        pluginEnabled: true,
        guildOptIn: true,
        responseMode: 'artifact',
        trustedInstructions: ['x'.repeat(4_001)],
      }),
    ).rejects.toMatchObject({ category: 'internal_error' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
