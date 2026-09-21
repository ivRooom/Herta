import { describe, expect, it, vi } from 'vitest';
import {
  AiConfigurationError,
  AiFoundationError,
  AiFoundationService,
  AnthropicMessagesProvider,
  OpenAiResponsesProvider,
  RedisAiGuardStore,
  estimateAnthropicCostMicroUsd,
  estimateInputTokens,
  estimateOpenAiCostMicroUsd,
  resolveAiFoundationConfig,
  toSafeAiFoundationError,
  type AiFoundationConfig,
  type AiGenerationProvider,
  type AiGenerationRequest,
  type AiGuardStore,
  type AiProviderRequest,
  type AiProviderResult,
  type AiQuotaReservationResult,
  type AiRateLimitResult,
  type AiTelemetryEvent,
  type RedisEvalClient,
} from './ai-service.js';

class MemoryGuardStore implements AiGuardStore {
  readonly rateKeys: string[] = [];
  readonly quotaKeys: string[] = [];
  readonly reservations = new Map<string, { guildKey: string; amount: number }>();
  readonly quotaTotals = new Map<string, number>();
  readonly rateCounts = new Map<string, number>();
  activeConcurrency = 0;
  denyConcurrency = false;

  async consumeRateLimit(key: string, limit: number): Promise<AiRateLimitResult> {
    this.rateKeys.push(key);
    const count = (this.rateCounts.get(key) ?? 0) + 1;
    this.rateCounts.set(key, count);
    return { allowed: count <= limit, retryAfterMs: count <= limit ? 0 : 500 };
  }

  async reserveGuildQuota(
    guildKey: string,
    requestId: string,
    amountMicroUsd: number,
    limitMicroUsd: number,
  ): Promise<AiQuotaReservationResult> {
    this.quotaKeys.push(guildKey);
    const total = this.quotaTotals.get(guildKey) ?? 0;
    if (total + amountMicroUsd > limitMicroUsd) return { allowed: false, retryAfterMs: 1_000 };
    this.quotaTotals.set(guildKey, total + amountMicroUsd);
    this.reservations.set(requestId, { guildKey, amount: amountMicroUsd });
    return { allowed: true, retryAfterMs: 0 };
  }

  async settleGuildQuota(
    guildKey: string,
    requestId: string,
    actualMicroUsd: number,
  ): Promise<number> {
    const reservation = this.reservations.get(requestId);
    if (!reservation) return this.quotaTotals.get(guildKey) ?? 0;
    const total = Math.max(
      0,
      (this.quotaTotals.get(guildKey) ?? 0) - reservation.amount + actualMicroUsd,
    );
    this.quotaTotals.set(guildKey, total);
    this.reservations.delete(requestId);
    return total;
  }

  async acquireConcurrency(): Promise<boolean> {
    if (this.denyConcurrency) return false;
    this.activeConcurrency += 1;
    return true;
  }

  async releaseConcurrency(): Promise<void> {
    this.activeConcurrency = Math.max(0, this.activeConcurrency - 1);
  }
}

function makeConfig(overrides: Partial<AiFoundationConfig> = {}): AiFoundationConfig {
  return {
    ...resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AiGenerationRequest> = {}): AiGenerationRequest {
  return {
    feature: 'knowledge.qa',
    input: 'Suggestionを取り下げるには？',
    guildId: 'guild-1',
    scopeGuildId: 'guild-1',
    userId: 'user-1',
    authorized: true,
    pluginEnabled: true,
    guildOptIn: true,
    ...overrides,
  };
}

function staticProvider(result: AiProviderResult = successProviderResult()): AiGenerationProvider {
  return { generate: vi.fn(async () => result) };
}

function successProviderResult(text = '回答です'): AiProviderResult {
  return {
    text,
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
  };
}

async function expectCategory(promise: Promise<unknown>, category: AiFoundationError['category']) {
  await expect(promise).rejects.toMatchObject({ category });
}

describe('resolveAiFoundationConfig', () => {
  it('AIは既定OFFでbalanced profileをgpt-5.6-terraへ解決する', () => {
    const config = resolveAiFoundationConfig({});
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('openai');
    expect(config.modelProfile).toBe('balanced');
    expect(config.model).toBe('gpt-5.6-terra');
  });

  it('unsupported providerを拒否する', () => {
    expect(() => resolveAiFoundationConfig({ HERTA_AI_PROVIDER: 'other' })).toThrowError(
      expect.objectContaining<Partial<AiConfigurationError>>({ code: 'invalid_provider' }),
    );
  });

  it('unsupported modelとprofileを拒否する', () => {
    expect(() =>
      resolveAiFoundationConfig({ HERTA_AI_MODEL: 'client-selected-model' }),
    ).toThrowError(
      expect.objectContaining<Partial<AiConfigurationError>>({ code: 'invalid_model' }),
    );
    expect(() => resolveAiFoundationConfig({ HERTA_AI_MODEL_PROFILE: 'ultra' })).toThrowError(
      expect.objectContaining<Partial<AiConfigurationError>>({ code: 'invalid_model' }),
    );
  });

  it('anthropic providerはbalanced profileをclaude-sonnet-5へ解決する', () => {
    const config = resolveAiFoundationConfig({ HERTA_AI_PROVIDER: 'anthropic' });
    expect(config.provider).toBe('anthropic');
    expect(config.modelProfile).toBe('balanced');
    expect(config.model).toBe('claude-sonnet-5');
  });

  it('anthropic providerでOpenAI model IDを指定すると拒否する', () => {
    expect(() =>
      resolveAiFoundationConfig({ HERTA_AI_PROVIDER: 'anthropic', HERTA_AI_MODEL: 'gpt-5.6-sol' }),
    ).toThrowError(
      expect.objectContaining<Partial<AiConfigurationError>>({ code: 'invalid_model' }),
    );
  });

  it('openai providerでAnthropic model IDを指定すると拒否する', () => {
    expect(() =>
      resolveAiFoundationConfig({ HERTA_AI_PROVIDER: 'openai', HERTA_AI_MODEL: 'claude-opus-5' }),
    ).toThrowError(
      expect.objectContaining<Partial<AiConfigurationError>>({ code: 'invalid_model' }),
    );
  });
});

describe('AiFoundationService', () => {
  it('normal generationでusage・cost・privacy-safe telemetryを返す', async () => {
    const guardStore = new MemoryGuardStore();
    const events: AiTelemetryEvent[] = [];
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig(),
      provider,
      guardStore,
      telemetry: (event) => {
        events.push(event);
      },
      requestId: () => 'request-1',
      now: (() => {
        let now = 1000;
        return () => (now += 10);
      })(),
    });

    const result = await service.generate(makeRequest());

    expect(result).toMatchObject({
      requestId: 'request-1',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      text: '回答です',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    expect(result.estimatedCost).toBe(0.00016);
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 800, model: 'gpt-5.6-terra' }),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      requestId: 'request-1',
      feature: 'knowledge.qa',
      resultCategory: 'success',
      errorCategory: null,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
    expect(guardStore.activeConcurrency).toBe(0);
  });

  it('anthropic providerでもguard/cost pipelineが同一に機能する', async () => {
    const guardStore = new MemoryGuardStore();
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig({
        provider: 'anthropic',
        modelProfile: 'balanced',
        model: 'claude-sonnet-5',
      }),
      provider,
      guardStore,
    });

    const result = await service.generate(makeRequest());

    expect(result).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      text: '回答です',
    });
    // usage: inputTokens 20, outputTokens 10 -> 20*2 + 10*10 = 140 micro-USD
    expect(result.estimatedCost).toBe(0.00014);
    expect(guardStore.quotaKeys.length).toBe(1);
  });

  it('global disabledとkill switchではproviderを呼ばない', async () => {
    for (const config of [makeConfig({ enabled: false }), makeConfig({ killSwitch: true })]) {
      const provider = staticProvider();
      const service = new AiFoundationService({
        config,
        provider,
        guardStore: new MemoryGuardStore(),
      });
      await expectCategory(service.generate(makeRequest()), 'disabled');
      expect(provider.generate).not.toHaveBeenCalled();
    }
  });

  it('Plugin disabledまたはGuild opt-inなしではproviderを呼ばない', async () => {
    for (const request of [
      makeRequest({ pluginEnabled: false }),
      makeRequest({ guildOptIn: false }),
    ]) {
      const provider = staticProvider();
      const service = new AiFoundationService({
        config: makeConfig(),
        provider,
        guardStore: new MemoryGuardStore(),
      });
      await expectCategory(service.generate(request), 'disabled');
      expect(provider.generate).not.toHaveBeenCalled();
    }
  });

  it('authorizationをserver-sideで必須にする', async () => {
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig(),
      provider,
      guardStore: new MemoryGuardStore(),
    });
    await expectCategory(service.generate(makeRequest({ authorized: false })), 'unauthorized');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('cross-Guild scopeをprovider呼び出し前に拒否する', async () => {
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig(),
      provider,
      guardStore: new MemoryGuardStore(),
    });
    await expectCategory(
      service.generate(makeRequest({ scopeGuildId: 'guild-2' })),
      'unauthorized',
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('min input 1文字とmax input境界を許可する', async () => {
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig({ maxInputChars: 3, maxInputBytes: 64 }),
      provider,
      guardStore: new MemoryGuardStore(),
    });
    await expect(service.generate(makeRequest({ input: 'a' }))).resolves.toBeDefined();
    await expect(
      service.generate(makeRequest({ input: 'abc', userId: 'user-2' })),
    ).resolves.toBeDefined();
  });

  it('empty・character oversized・byte oversized inputを拒否する', async () => {
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig({ maxInputChars: 3, maxInputBytes: 5 }),
      provider,
      guardStore: new MemoryGuardStore(),
    });

    await expectCategory(service.generate(makeRequest({ input: '   ' })), 'invalid_input');
    await expectCategory(service.generate(makeRequest({ input: 'abcd' })), 'invalid_input');
    await expectCategory(service.generate(makeRequest({ input: 'ああ' })), 'invalid_input');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('output character boundを超えたresponseを返さない', async () => {
    const service = new AiFoundationService({
      config: makeConfig({ maxOutputChars: 3 }),
      provider: staticProvider(successProviderResult('1234')),
      guardStore: new MemoryGuardStore(),
    });
    await expectCategory(service.generate(makeRequest()), 'output_too_large');
  });

  it('provider timeoutをsafe taxonomyへ維持する', async () => {
    const provider: AiGenerationProvider = {
      generate: async () => {
        throw new AiFoundationError('timeout');
      },
    };
    const service = new AiFoundationService({
      config: makeConfig(),
      provider,
      guardStore: new MemoryGuardStore(),
    });
    await expectCategory(service.generate(makeRequest()), 'timeout');
  });

  it('per-user rate limitを共有storeで強制する', async () => {
    const service = new AiFoundationService({
      config: makeConfig({ userRateLimit: 1, guildRateLimit: 100 }),
      provider: staticProvider(),
      guardStore: new MemoryGuardStore(),
    });
    await service.generate(makeRequest());
    await expectCategory(service.generate(makeRequest()), 'rate_limited');
  });

  it('per-Guild rate limitを異なるuserでも共有する', async () => {
    const service = new AiFoundationService({
      config: makeConfig({ userRateLimit: 100, guildRateLimit: 1 }),
      provider: staticProvider(),
      guardStore: new MemoryGuardStore(),
    });
    await service.generate(makeRequest({ userId: 'user-1' }));
    await expectCategory(service.generate(makeRequest({ userId: 'user-2' })), 'rate_limited');
  });

  it('Guild quotaをprovider呼び出し前に予約して超過を拒否する', async () => {
    const provider = staticProvider();
    const service = new AiFoundationService({
      config: makeConfig({
        guildQuotaMicroUsd: 8,
        maxOutputTokens: 1,
        perRequestCostLimitMicroUsd: 100,
      }),
      provider,
      guardStore: new MemoryGuardStore(),
    });
    await expectCategory(service.generate(makeRequest({ input: 'a' })), 'quota_exceeded');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('per-request cost guardをquota予約前に強制する', async () => {
    const provider = staticProvider();
    const store = new MemoryGuardStore();
    const service = new AiFoundationService({
      config: makeConfig({ maxOutputTokens: 800, perRequestCostLimitMicroUsd: 10 }),
      provider,
      guardStore: store,
    });
    await expectCategory(service.generate(makeRequest()), 'quota_exceeded');
    expect(store.quotaKeys).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('preflight cost guardはUTF-8 byte長を保守的token上限として使う', async () => {
    const provider = staticProvider();
    const store = new MemoryGuardStore();
    const service = new AiFoundationService({
      config: makeConfig({ maxOutputTokens: 1, perRequestCostLimitMicroUsd: 31 }),
      provider,
      guardStore: store,
    });

    await expectCategory(service.generate(makeRequest({ input: 'abcdefghij' })), 'quota_exceeded');
    expect(store.quotaKeys).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('global concurrency limit拒否時はproviderを呼ばずquota予約を解放する', async () => {
    const store = new MemoryGuardStore();
    store.denyConcurrency = true;
    const provider = staticProvider();
    const service = new AiFoundationService({ config: makeConfig(), provider, guardStore: store });

    await expectCategory(service.generate(makeRequest()), 'rate_limited');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.reservations.size).toBe(0);
  });

  it('Redis等へ渡すrate/quota keyにraw Guild/User IDを残さない', async () => {
    const store = new MemoryGuardStore();
    const service = new AiFoundationService({
      config: makeConfig(),
      provider: staticProvider(),
      guardStore: store,
    });
    await service.generate(
      makeRequest({ guildId: 'guild-secret', scopeGuildId: 'guild-secret', userId: 'user-secret' }),
    );

    const keys = [...store.rateKeys, ...store.quotaKeys].join(' ');
    expect(keys).not.toContain('guild-secret');
    expect(keys).not.toContain('user-secret');
  });

  it('raw prompt / raw responseをtelemetryへ保存しない', async () => {
    const rawPrompt = 'RAW_PROMPT_SHOULD_NEVER_BE_LOGGED';
    const rawResponse = 'RAW_RESPONSE_SHOULD_NEVER_BE_LOGGED';
    const events: AiTelemetryEvent[] = [];
    const service = new AiFoundationService({
      config: makeConfig(),
      provider: staticProvider(successProviderResult(rawResponse)),
      guardStore: new MemoryGuardStore(),
      telemetry: (event) => {
        events.push(event);
      },
    });

    const result = await service.generate(makeRequest({ input: rawPrompt }));
    expect(result.text).toBe(rawResponse);
    const serializedTelemetry = JSON.stringify(events);
    expect(serializedTelemetry).not.toContain(rawPrompt);
    expect(serializedTelemetry).not.toContain(rawResponse);
  });

  it('unknown internal errorをraw messageなしのinternal_errorへ変換する', () => {
    const safe = toSafeAiFoundationError(new Error('raw provider secret response'));
    expect(safe.category).toBe('internal_error');
    expect(safe.message).not.toContain('raw provider secret response');
    expect(safe.userMessage).toBe('AI機能の処理中にエラーが発生しました。');
  });
});

describe('OpenAiResponsesProvider', () => {
  const request: AiProviderRequest = {
    requestId: 'req-1',
    model: 'gpt-5.6-terra',
    input: 'hello',
    maxOutputTokens: 100,
    timeoutMs: 100,
    maxResponseBytes: 16_384,
  };

  it('Responses APIへstore:falseとbounded outputを送信しusageを解析する', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'gpt-5.6-terra',
        input: 'hello',
        max_output_tokens: 100,
        store: false,
        truncation: 'disabled',
      });
      expect((init?.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer server-secret',
      );
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'world', annotations: [] }],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
      });
    });
    const provider = new OpenAiResponsesProvider({ apiKey: 'server-secret', fetchImpl });

    await expect(provider.generate(request)).resolves.toEqual({
      text: 'world',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
  });

  it('provider 4xxをprovider_rejectedへ安全に変換する', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'secret',
      fetchImpl: async () => new Response('provider raw error', { status: 401 }),
    });
    await expectCategory(provider.generate(request), 'provider_rejected');
  });

  it('provider 429/5xxをprovider_unavailableへ変換する', async () => {
    for (const status of [429, 503]) {
      const provider = new OpenAiResponsesProvider({
        apiKey: 'secret',
        fetchImpl: async () => new Response('provider raw error', { status }),
      });
      await expectCategory(provider.generate(request), 'provider_unavailable');
    }
  });

  it('malformed provider responseを拒否する', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'secret',
      fetchImpl: async () => Response.json({ status: 'completed', output: [], usage: null }),
    });
    await expectCategory(provider.generate(request), 'malformed_response');
  });

  it('provider response byte上限を強制する', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ output: [], usage: {} }), {
          status: 200,
          headers: { 'content-length': '999999' },
        }),
    });
    await expectCategory(
      provider.generate({ ...request, maxResponseBytes: 100 }),
      'malformed_response',
    );
  });

  it('AbortController timeoutをtimeoutへ変換する', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'secret',
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    await expectCategory(provider.generate({ ...request, timeoutMs: 1 }), 'timeout');
  });

  it('headers受信後にresponse bodyがstallしてもtimeoutする', async () => {
    const provider = new OpenAiResponsesProvider({
      apiKey: 'secret',
      fetchImpl: async (_input, init) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
          },
        });
        return new Response(stream, { status: 200 });
      },
    });

    await expectCategory(provider.generate({ ...request, timeoutMs: 5 }), 'timeout');
  });
});

describe('AnthropicMessagesProvider', () => {
  const request: AiProviderRequest = {
    requestId: 'req-1',
    model: 'claude-sonnet-5',
    input: 'hello',
    maxOutputTokens: 100,
    timeoutMs: 100,
    maxResponseBytes: 16_384,
  };

  it('Messages APIへx-api-key/anthropic-versionを送信しusageを解析する', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'claude-sonnet-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'high' },
      });
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('server-secret');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 7 },
      });
    });
    const provider = new AnthropicMessagesProvider({ apiKey: 'server-secret', fetchImpl });

    await expect(provider.generate(request)).resolves.toEqual({
      text: 'world',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
  });

  it('claude-haiku-4-5-20251001はoutput_configを一切送らない', async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('output_config');
      return Response.json({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2 },
      });
    });
    const provider = new AnthropicMessagesProvider({ apiKey: 'secret', fetchImpl });
    await provider.generate({ ...request, model: 'claude-haiku-4-5-20251001' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stop_reason max_tokensをoutput_too_largeへ変換する', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        Response.json({
          content: [{ type: 'text', text: 'partial' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
    });
    await expectCategory(provider.generate(request), 'output_too_large');
  });

  it('400/401/403/404/409/413をprovider_rejectedへ安全に変換する', async () => {
    for (const status of [400, 401, 403, 404, 409, 413]) {
      const provider = new AnthropicMessagesProvider({
        apiKey: 'secret',
        fetchImpl: async () => new Response('anthropic raw error', { status }),
      });
      await expectCategory(provider.generate(request), 'provider_rejected');
    }
  });

  it('429/5xxをprovider_unavailableへ変換する', async () => {
    for (const status of [429, 500, 504, 529]) {
      const provider = new AnthropicMessagesProvider({
        apiKey: 'secret',
        fetchImpl: async () => new Response('anthropic raw error', { status }),
      });
      await expectCategory(provider.generate(request), 'provider_unavailable');
    }
  });

  it('malformed provider responseを拒否する', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: async () => Response.json({ content: [], usage: null }),
    });
    await expectCategory(provider.generate(request), 'malformed_response');
  });

  it('refusal stop_reasonでtextが空の場合はprovider_rejectedにする', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        Response.json({
          content: [],
          stop_reason: 'refusal',
          usage: { input_tokens: 3, output_tokens: 0 },
        }),
    });
    await expectCategory(provider.generate(request), 'provider_rejected');
  });

  it('provider response byte上限を強制する', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ content: [], usage: {} }), {
          status: 200,
          headers: { 'content-length': '999999' },
        }),
    });
    await expectCategory(
      provider.generate({ ...request, maxResponseBytes: 100 }),
      'malformed_response',
    );
  });

  it('AbortController timeoutをtimeoutへ変換する', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    await expectCategory(provider.generate({ ...request, timeoutMs: 1 }), 'timeout');
  });

  it('raw error responseをAiFoundationErrorのmessageへ含めない', async () => {
    const provider = new AnthropicMessagesProvider({
      apiKey: 'secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'RAW_ANTHROPIC_ERROR_DETAIL' },
          }),
          { status: 400 },
        ),
    });
    try {
      await provider.generate(request);
      throw new Error('expected rejection');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('RAW_ANTHROPIC_ERROR_DETAIL');
    }
  });
});

describe('cost estimation', () => {
  it('gpt-5.6-terra standard pricingからmicro USDを算出する', () => {
    expect(estimateOpenAiCostMicroUsd('gpt-5.6-terra', 20, 10)).toBe(160);
  });

  it('preflight input token estimateはUTF-8 byte長を保守的上限として使う', () => {
    expect(estimateInputTokens('abc')).toBe(3);
    expect(estimateInputTokens('あ')).toBe(3);
  });

  it('claude-sonnet-5 standard pricingからmicro USDを算出する', () => {
    expect(estimateAnthropicCostMicroUsd('claude-sonnet-5', 20, 10)).toBe(140);
  });

  it('全Anthropic profileのpricingを算出する', () => {
    expect(estimateAnthropicCostMicroUsd('claude-opus-5', 1_000_000, 0)).toBe(5_000_000);
    expect(estimateAnthropicCostMicroUsd('claude-opus-5', 0, 1_000_000)).toBe(25_000_000);
    expect(estimateAnthropicCostMicroUsd('claude-sonnet-5', 1_000_000, 0)).toBe(2_000_000);
    expect(estimateAnthropicCostMicroUsd('claude-sonnet-5', 0, 1_000_000)).toBe(10_000_000);
    expect(estimateAnthropicCostMicroUsd('claude-haiku-4-5-20251001', 1_000_000, 0)).toBe(
      1_000_000,
    );
    expect(estimateAnthropicCostMicroUsd('claude-haiku-4-5-20251001', 0, 1_000_000)).toBe(
      5_000_000,
    );
  });
});

describe('RedisAiGuardStore', () => {
  it('Redis eval結果をrate/quota/concurrency contractへ変換する', async () => {
    const evalMock = vi
      .fn<RedisEvalClient['eval']>()
      .mockResolvedValueOnce([1, 60_000])
      .mockResolvedValueOnce([1, 100, 86_400_000])
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const store = new RedisAiGuardStore({ redis: { eval: evalMock }, now: () => 1000 });

    await expect(store.consumeRateLimit('user:hash', 6, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    await expect(
      store.reserveGuildQuota('guild:hash', 'req', 100, 1000, 86_400_000),
    ).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    await expect(store.settleGuildQuota('guild:hash', 'req', 80)).resolves.toBe(80);
    await expect(store.acquireConcurrency('req', 4, 17_000)).resolves.toBe(true);
    await expect(store.releaseConcurrency('req')).resolves.toBeUndefined();
    expect(evalMock).toHaveBeenCalledTimes(5);
  });
});
