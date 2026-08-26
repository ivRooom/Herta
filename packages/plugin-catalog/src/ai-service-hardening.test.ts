import { describe, expect, it, vi } from 'vitest';
import {
  AI_DEFAULTS,
  AiFoundationService,
  OpenAiResponsesProvider,
  RedisAiGuardStore,
  estimateInputTokens,
  estimateOpenAiCostMicroUsd,
  resolveAiFoundationConfig,
  type AiFoundationConfig,
  type AiGenerationProvider,
  type AiGuardStore,
  type RedisEvalClient,
} from './ai-service.js';

const fixedNow = Date.parse('2026-08-26T00:00:00.000Z');

function makeConfig(overrides: Partial<AiFoundationConfig> = {}): AiFoundationConfig {
  return {
    ...resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
    ...overrides,
  };
}

function allowAllGuardStore(): AiGuardStore {
  return {
    consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
    reserveGuildQuota: async () => ({ allowed: true, retryAfterMs: 0 }),
    settleGuildQuota: async (_guildKey, _requestId, actualMicroUsd) => actualMicroUsd,
    acquireConcurrency: async () => true,
    releaseConcurrency: async () => undefined,
  };
}

function staticProvider(): AiGenerationProvider {
  return {
    generate: async () => ({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  };
}

describe('AI Foundation post-merge hardening', () => {
  it('公開済み最大入力・出力boundを全profileの既定cost cap内で予約できる', () => {
    const input = 'あ'.repeat(AI_DEFAULTS.maxInputChars);
    const inputTokens = estimateInputTokens(input);

    expect(inputTokens).toBe(AI_DEFAULTS.maxInputBytes);
    expect(
      estimateOpenAiCostMicroUsd('gpt-5.6-sol', inputTokens, AI_DEFAULTS.maxOutputTokens),
    ).toBe(112_000);
    expect(
      estimateOpenAiCostMicroUsd('gpt-5.6-terra', inputTokens, AI_DEFAULTS.maxOutputTokens),
    ).toBe(57_600);
    expect(
      estimateOpenAiCostMicroUsd('gpt-5.6-luna', inputTokens, AI_DEFAULTS.maxOutputTokens),
    ).toBe(5_760);
    expect(AI_DEFAULTS.perRequestCostLimitMicroUsd).toBeGreaterThanOrEqual(112_000);
  });

  it('telemetry sinkがsettleしなくてもuser-facing generationをblockしない', async () => {
    let telemetryCalled = false;
    const service = new AiFoundationService({
      config: makeConfig(),
      provider: staticProvider(),
      guardStore: allowAllGuardStore(),
      now: () => fixedNow,
      telemetry: () => {
        telemetryCalled = true;
        return new Promise<void>(() => undefined);
      },
    });

    const result = await Promise.race([
      service.generate({
        feature: 'hardening.test',
        input: 'hello',
        guildId: 'guild-1',
        scopeGuildId: 'guild-1',
        userId: 'user-1',
        authorized: true,
        pluginEnabled: true,
        guildOptIn: true,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('telemetry blocked the response')), 50);
      }),
    ]);

    expect(result.text).toBe('ok');
    expect(telemetryCalled).toBe(true);
  });

  it('Sol promotional pricing review deadline後はprice refreshなしでprovider callしない', async () => {
    const provider = staticProvider();
    const generateSpy = vi.spyOn(provider, 'generate');
    const service = new AiFoundationService({
      config: makeConfig({ modelProfile: 'quality', model: 'gpt-5.6-sol' }),
      provider,
      guardStore: allowAllGuardStore(),
      now: () => Date.parse('2026-11-22T00:00:00.000Z'),
    });

    await expect(
      service.generate({
        feature: 'hardening.test',
        input: 'hello',
        guildId: 'guild-1',
        scopeGuildId: 'guild-1',
        userId: 'user-1',
        authorized: true,
        pluginEnabled: true,
        guildOptIn: true,
      }),
    ).rejects.toMatchObject({ category: 'disabled' });
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('Responses APIのincomplete partial outputを成功扱いしない', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'server-secret',
      fetchImpl: async () =>
        Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'partial', annotations: [] }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 100, total_tokens: 105 },
        }),
    });

    await expect(
      provider.generate({
        requestId: 'req-1',
        model: 'gpt-5.6-terra',
        input: 'hello',
        maxOutputTokens: 100,
        timeoutMs: 100,
        maxResponseBytes: 16_384,
      }),
    ).rejects.toMatchObject({ category: 'output_too_large' });
  });

  it('Guild quota Luaはaccepted reservationでtotal TTLを再延長せずreservationsを残TTLへ合わせる', async () => {
    const evalMock = vi.fn<RedisEvalClient['eval']>().mockResolvedValue([1, 100, 42_000]);
    const store = new RedisAiGuardStore({ redis: { eval: evalMock }, now: () => fixedNow });

    await store.reserveGuildQuota('guild:hash', 'request-1', 100, 1_000, 86_400_000);

    const script = String(evalMock.mock.calls[0]?.[0]);
    expect(script).toContain("local startsNewWindow = redis.call('EXISTS', KEYS[1]) == 0");
    expect(script).toContain(
      "if startsNewWindow then redis.call('PEXPIRE', KEYS[1], ARGV[4]) end",
    );
    expect(script).toContain("local ttl = redis.call('PTTL', KEYS[1])");
    expect(script).toContain("redis.call('PEXPIRE', KEYS[2], ttl)");
    expect(script).not.toContain(
      "redis.call('PEXPIRE', KEYS[1], ARGV[4])\nredis.call('PEXPIRE', KEYS[2], ARGV[4])",
    );
  });

  it('quota超過retryAfterMsはLuaが返したfixed window残TTLをそのまま使う', async () => {
    const evalMock = vi.fn<RedisEvalClient['eval']>().mockResolvedValue([0, 950, 12_345]);
    const store = new RedisAiGuardStore({ redis: { eval: evalMock }, now: () => fixedNow });

    await expect(
      store.reserveGuildQuota('guild:hash', 'request-2', 100, 1_000, 86_400_000),
    ).resolves.toEqual({ allowed: false, retryAfterMs: 12_345 });
  });
});
