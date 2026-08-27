import type { RuntimeConfigurationRecord } from '@herta/db';
import {
  AiFoundationError,
  resolveAiFoundationConfig,
  type AiGuardStore,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import {
  AiImageGenerationError,
  OpenAiImageGenerationService,
  decodeStrictBase64,
  type AiImageGenerationRequest,
} from './image-generation-service.js';

const prisma = {} as ConstructorParameters<typeof AiRuntimeConfigurationResolver>[0]['prisma'];

function stored(): RuntimeConfigurationRecord {
  return {
    name: 'ai.runtime',
    value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' },
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-08-27T00:00:00Z'),
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

interface GuardObservation {
  reservations: number[];
  settled: number[];
  rateCalls: number;
  concurrencyCalls: number;
  releaseCalls: number;
}

function guardStore(
  observation: GuardObservation,
  options: { denyImageQuota?: boolean; denyConcurrency?: boolean } = {},
): AiGuardStore {
  let reservationCalls = 0;
  return {
    consumeRateLimit: async () => {
      observation.rateCalls += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
    reserveGuildQuota: async (_key, _requestId, amount) => {
      reservationCalls += 1;
      observation.reservations.push(amount);
      if (options.denyImageQuota && reservationCalls === 2) {
        return { allowed: false, retryAfterMs: 1000 };
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    settleGuildQuota: async (_guildKey, _requestId, actual) => {
      observation.settled.push(actual);
      return actual;
    },
    acquireConcurrency: async () => {
      observation.concurrencyCalls += 1;
      return !options.denyConcurrency;
    },
    releaseConcurrency: async () => {
      observation.releaseCalls += 1;
    },
  };
}

function observation(): GuardObservation {
  return { reservations: [], settled: [], rateCalls: 0, concurrencyCalls: 0, releaseCalls: 0 };
}

const request: AiImageGenerationRequest = {
  input: '白い背景に青いロボットのアイコン画像を生成して',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

function imageResponse(
  result: string | null = Buffer.from('image-bytes').toString('base64'),
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'image_generation_call',
        id: 'ig_1',
        status: 'completed',
        ...(result === null ? {} : { result }),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    ...overrides,
  });
}

function service(
  fetchImpl: typeof fetch,
  guard: AiGuardStore,
  overrides: Partial<ReturnType<typeof resolveAiFoundationConfig>> = {},
  now = () => Date.parse('2026-08-27T09:00:00Z'),
) {
  return new OpenAiImageGenerationService({
    baseConfig: {
      ...resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      ...overrides,
    },
    apiKey: 'server-secret',
    guardStore: guard,
    toolGuardStore: guard,
    runtimeResolver: resolver(),
    fetchImpl,
    now,
  });
}

describe('OpenAiImageGenerationService', () => {
  it('Responses image_generation toolを1回だけ要求しinline base64実体を返す', async () => {
    const seen = observation();
    let requestBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requestBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;
      return imageResponse();
    });

    const result = await service(fetchImpl, guardStore(seen)).generate(request);

    expect(new TextDecoder().decode(result.file.bytes)).toBe('image-bytes');
    expect(result.file).toMatchObject({ filename: 'generated-image.png', mimeType: 'image/png' });
    expect(result.imageBillingModel).toBe('gpt-image-2');
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0.006);
    expect(requestBody.tools).toEqual([
      { type: 'image_generation', size: '1024x1024', quality: 'low' },
    ]);
    expect(requestBody.tool_choice).toEqual({ type: 'image_generation' });
    expect(requestBody.max_tool_calls).toBe(1);
    expect(requestBody.parallel_tool_calls).toBe(false);
    expect(JSON.stringify(requestBody)).not.toContain('server-secret');
    expect(seen.rateCalls).toBe(2);
    expect(seen.concurrencyCalls).toBe(2);
    expect(seen.releaseCalls).toBe(2);
    expect(seen.reservations.length).toBeGreaterThanOrEqual(2);
    expect(seen.reservations.some((amount) => amount >= 6_000)).toBe(true);
  });

  it('image tool未実行をfake successにしない', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
    await expect(service(fetchImpl, guardStore(observation())).generate(request)).rejects.toMatchObject(
      { category: 'tool_not_invoked' },
    );
  });

  it('empty result / invalid base64を拒否する', async () => {
    const empty = vi.fn<typeof fetch>(async () => imageResponse(null));
    await expect(service(empty, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'empty_result',
    });

    const invalid = vi.fn<typeof fetch>(async () => imageResponse('%%%not-base64%%%'));
    await expect(service(invalid, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'invalid_base64',
    });
  });

  it('provider URL返却は取得せずSSRF-safeにrejectする', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'image_generation_call',
            id: 'ig_url',
            status: 'completed',
            url: 'http://127.0.0.1:8080/private-image.png',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );

    await expect(service(fetchImpl, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'provider_url_rejected',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('複数image callをoutput file limitとしてrejectする', async () => {
    const base64 = Buffer.from('x').toString('base64');
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: 'completed',
        output: [
          { type: 'image_generation_call', result: base64 },
          { type: 'image_generation_call', result: base64 },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
    await expect(service(fetchImpl, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'output_limit_exceeded',
    });
  });

  it('provider 5xx/429/4xxを既存Foundation taxonomyで返す', async () => {
    const unavailable = vi.fn<typeof fetch>(async () => new Response('fail', { status: 503 }));
    await expect(service(unavailable, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'provider_unavailable',
    });

    const rateLimited = vi.fn<typeof fetch>(async () => new Response('busy', { status: 429 }));
    await expect(
      service(rateLimited, guardStore(observation())).generate(request),
    ).rejects.toMatchObject({ category: 'provider_unavailable' });

    const rejected = vi.fn<typeof fetch>(async () => new Response('bad', { status: 400 }));
    await expect(service(rejected, guardStore(observation())).generate(request)).rejects.toMatchObject({
      category: 'provider_rejected',
    });
  });

  it('既存Foundation timeout signalをそのまま利用する', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
    );
    await expect(
      service(fetchImpl, guardStore(observation()), { timeoutMs: 10 }).generate(request),
    ).rejects.toMatchObject({ category: 'timeout' });
  });

  it('Guild quota / global+tool concurrency / per-request cost guardを迂回しない', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => imageResponse());
    const quotaSeen = observation();
    await expect(
      service(fetchImpl, guardStore(quotaSeen, { denyImageQuota: true })).generate(request),
    ).rejects.toMatchObject({ category: 'quota_exceeded' });

    const concurrencyFetch = vi.fn<typeof fetch>(async () => imageResponse());
    await expect(
      service(concurrencyFetch, guardStore(observation(), { denyConcurrency: true })).generate(request),
    ).rejects.toMatchObject({ category: 'rate_limited' });
    expect(concurrencyFetch).not.toHaveBeenCalled();

    const costFetch = vi.fn<typeof fetch>(async () => imageResponse());
    await expect(
      service(costFetch, guardStore(observation()), { perRequestCostLimitMicroUsd: 5_000 }).generate(
        request,
      ),
    ).rejects.toMatchObject({ category: 'quota_exceeded' });
    expect(costFetch).not.toHaveBeenCalled();
  });

  it('pricing freshness期限後はproviderを呼ばずfail closedする', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      service(
        fetchImpl,
        guardStore(observation()),
        {},
        () => Date.parse('2026-09-27T00:00:00Z'),
      ).generate(request),
    ).rejects.toMatchObject({ category: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('strict base64 decoderはoversize/非canonical入力を拒否する', () => {
    expect(() => decodeStrictBase64('YWJjZA', 1024)).toThrow(AiImageGenerationError);
    expect(() => decodeStrictBase64(Buffer.alloc(32).toString('base64'), 8)).toThrow(
      AiImageGenerationError,
    );
  });
});
