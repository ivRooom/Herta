import type { RuntimeConfigurationRecord } from '@herta/db';
import {
  AiFoundationError,
  resolveAiFoundationConfig,
  type AiGuardStore,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import {
  AiCodeExecutionError,
  OpenAiCodeExecutionService,
  type AiCodeExecutionRequest,
} from './code-execution-service.js';

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

function guardStore(reservations: number[] = []): AiGuardStore {
  return {
    consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
    reserveGuildQuota: async (_key, _requestId, amount) => {
      reservations.push(amount);
      return { allowed: true, retryAfterMs: 0 };
    },
    settleGuildQuota: async (_guildKey, _requestId, actual) => actual,
    acquireConcurrency: async () => true,
    releaseConcurrency: async () => undefined,
  };
}

const request: AiCodeExecutionRequest = {
  input: 'このPythonコードを実行してCSVにして',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
  artifactConfig: { maxBytes: 4096, maxFiles: 2 },
};

function containerResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    id: 'cntr_test',
    memory_limit: '1g',
    network_policy: { type: 'disabled' },
    ...overrides,
  });
}

function executionResponse(
  annotations: Array<Record<string, unknown>> = [
    {
      type: 'container_file_citation',
      container_id: 'cntr_test',
      file_id: 'cfile_1',
      filename: 'result.csv',
    },
  ],
  includeTool = true,
) {
  return Response.json({
    status: 'completed',
    output: [
      ...(includeTool ? [{ type: 'code_interpreter_call', id: 'ci_1', status: 'completed' }] : []),
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '処理は正常に完了し、CSVを生成しました。',
            annotations,
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('OpenAiCodeExecutionService', () => {
  it('1GB/network-deny sandboxで実行し、実file bytesを取得して成功前にdestroyする', async () => {
    const reservations: number[] = [];
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const csv = 'name,value\na,1\nb,2\n';
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });

      if (url.endsWith('/containers') && method === 'POST') return containerResponse();
      if (url.endsWith('/responses') && method === 'POST') return executionResponse();
      if (url.endsWith('/files/cfile_1/content')) {
        return new Response(csv, { headers: { 'content-type': 'text/csv' } });
      }
      if (url.endsWith('/containers/cntr_test') && method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(reservations),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    const result = await service.execute(request);

    expect(result.sandboxDestroyed).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.filename).toBe('result.csv');
    expect(new TextDecoder().decode(result.files[0]?.bytes)).toBe(csv);
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0.03);
    expect(reservations).toContain(30_000);

    const createBody = JSON.parse(calls.find((call) => call.url.endsWith('/containers'))?.body ?? '{}');
    expect(createBody).toEqual({
      name: 'herta-python-execution',
      memory_limit: '1g',
      network_policy: { type: 'disabled' },
    });
    expect(JSON.stringify(createBody)).not.toContain('server-secret');
    expect(createBody).not.toHaveProperty('env');
    expect(createBody).not.toHaveProperty('files');

    const responseBody = JSON.parse(calls.find((call) => call.url.endsWith('/responses'))?.body ?? '{}');
    expect(responseBody.tools).toEqual([{ type: 'code_interpreter', container: 'cntr_test' }]);
    expect(responseBody.tool_choice).toBe('required');
    expect(responseBody.max_tool_calls).toBe(8);
    expect(responseBody.parallel_tool_calls).toBe(false);
    expect(responseBody).not.toHaveProperty('include');
    expect(JSON.stringify(responseBody)).not.toContain('server-secret');

    const responseIndex = calls.findIndex((call) => call.url.endsWith('/responses'));
    const deleteIndex = calls.findIndex(
      (call) => call.url.endsWith('/containers/cntr_test') && call.method === 'DELETE',
    );
    expect(responseIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(responseIndex);
  });

  it('Code Interpreterが実際に呼ばれていなければfake successを拒否しcleanupする', async () => {
    let deleted = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse([], false);
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 200 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toMatchObject({ category: 'tool_not_invoked' });
    expect(deleted).toBe(true);
  });

  it('output file数上限超過をdownload前に拒否する', async () => {
    let downloads = 0;
    const annotations = ['1', '2'].map((suffix) => ({
      type: 'container_file_citation',
      container_id: 'cntr_test',
      file_id: `cfile_${suffix}`,
      filename: `result-${suffix}.csv`,
    }));
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse(annotations);
      if (url.includes('/files/')) {
        downloads += 1;
        return new Response('x', { headers: { 'content-type': 'text/csv' } });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(
      service.execute({ ...request, artifactConfig: { maxBytes: 4096, maxFiles: 1 } }),
    ).rejects.toMatchObject({ category: 'output_limit_exceeded' });
    expect(downloads).toBe(0);
  });

  it('download MIME mismatchをartifact delivery前に拒否する', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse();
      if (url.endsWith('/files/cfile_1/content')) {
        return new Response('{"not":"csv"}', { headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toMatchObject({
      category: 'artifact_download_failed',
    });
  });

  it('sandbox cleanup失敗を成功扱いにしない', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse([], true);
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 500 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toMatchObject({ category: 'cleanup_failed' });
  });

  it('wall-clock timeoutを既存Foundation timeoutとして返しcleanupする', async () => {
    let deleted = false;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 200 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: { ...resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }), timeoutMs: 10 },
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toBeInstanceOf(AiFoundationError);
    await expect(service.execute(request)).rejects.toMatchObject({ category: 'timeout' });
    expect(deleted).toBe(true);
  });

  it('pricing freshness期限後はprovider/containerを呼ばずfail closedする', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-09-27T00:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toMatchObject({ category: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sandbox policy confirmationがnetwork disabledでなければ拒否する', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') {
        return containerResponse({ network_policy: { type: 'allowlist', allowed_domains: [] } });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error('unexpected request');
    });
    const service = new OpenAiCodeExecutionService({
      baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
      apiKey: 'server-secret',
      guardStore: guardStore(),
      runtimeResolver: resolver(),
      fetchImpl,
      now: () => Date.parse('2026-08-27T09:00:00Z'),
    });

    await expect(service.execute(request)).rejects.toBeInstanceOf(AiCodeExecutionError);
    await expect(service.execute(request)).rejects.toMatchObject({ category: 'sandbox_policy_failed' });
  });
});
