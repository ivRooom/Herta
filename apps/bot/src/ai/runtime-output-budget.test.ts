import type { RuntimeConfigurationRecord } from '@herta/db';
import { resolveAiFoundationConfig, type AiGuardStore } from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenAiRuntimeGenerationService,
  resolveAiRuntimeOutputTokenBudget,
} from './runtime-service.js';

const prisma = {} as ConstructorParameters<typeof AiRuntimeConfigurationResolver>[0]['prisma'];

function stored(): RuntimeConfigurationRecord {
  return {
    name: 'ai.runtime',
    value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' },
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-09-02T00:00:00Z'),
  };
}

function resolver() {
  return new AiRuntimeConfigurationResolver({
    prisma,
    env: {},
    ttlMs: 0,
    readConfiguration: vi.fn().mockResolvedValue(stored()),
  });
}

function completedResponse() {
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
}

function request(userId: string, responseMode: 'chat' | 'detailed' | 'artifact') {
  return {
    feature: 'runtime.output-budget.test',
    input: 'ReactとVueを比較して',
    guildId: 'guild-1',
    scopeGuildId: 'guild-1',
    userId,
    authorized: true,
    pluginEnabled: true,
    guildOptIn: true,
    responseMode,
  } as const;
}

describe('AI runtime output token budget', () => {
  it('chatは800、detailed/artifactはconfigured hard capまで利用する', () => {
    expect(resolveAiRuntimeOutputTokenBudget(2_048, 'chat')).toBe(800);
    expect(resolveAiRuntimeOutputTokenBudget(2_048, 'detailed')).toBe(2_048);
    expect(resolveAiRuntimeOutputTokenBudget(2_048, 'artifact')).toBe(2_048);
  });

  it('operatorがhard capを下げた場合はすべてのmodeでその上限を尊重する', () => {
    expect(resolveAiRuntimeOutputTokenBudget(500, 'chat')).toBe(500);
    expect(resolveAiRuntimeOutputTokenBudget(500, 'detailed')).toBe(500);
    expect(resolveAiRuntimeOutputTokenBudget(500, 'artifact')).toBe(500);
  });

  it('provider requestとcost reservationへrequest-scoped budgetを適用する', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const reservations: number[] = [];
    const guardStore: AiGuardStore = {
      consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
      reserveGuildQuota: async (_guildKey, _requestId, amountMicroUsd) => {
        reservations.push(amountMicroUsd);
        return { allowed: true, retryAfterMs: 0 };
      },
      settleGuildQuota: async (_guildKey, _requestId, actualMicroUsd) => actualMicroUsd,
      acquireConcurrency: async () => true,
      releaseConcurrency: async () => undefined,
    };
    const service = new OpenAiRuntimeGenerationService({
      baseConfig: resolveAiFoundationConfig({
        HERTA_AI_ENABLED: 'true',
        HERTA_AI_MAX_OUTPUT_TOKENS: '2048',
      }),
      apiKey: 'server-secret',
      guardStore,
      runtimeResolver: resolver(),
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return completedResponse();
      },
    });

    await service.generate(request('user-chat', 'chat'));
    await service.generate(request('user-detailed', 'detailed'));
    await service.generate(request('user-artifact', 'artifact'));

    expect(bodies.map((body) => body['max_output_tokens'])).toEqual([800, 2_048, 2_048]);
    expect(reservations).toHaveLength(3);
    expect(reservations[1]).toBeGreaterThan(reservations[0] ?? 0);
    expect(reservations[2]).toBeGreaterThan(reservations[0] ?? 0);
  });
});
