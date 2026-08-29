import type { RuntimeConfigurationRecord } from '@herta/db';
import {
  resolveAiFoundationConfig,
  type AiGuardStore,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiCodeExecutionService, type AiCodeExecutionRequest } from './code-execution-service.js';

const prisma = {} as ConstructorParameters<typeof AiRuntimeConfigurationResolver>[0]['prisma'];

function stored(): RuntimeConfigurationRecord {
  return {
    name: 'ai.runtime',
    value: { provider: 'openai', modelProfile: 'balanced', reasoningEffort: 'low' },
    updatedBy: 'admin-1',
    updatedAt: new Date('2026-08-29T00:00:00Z'),
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

function guardStore(): AiGuardStore {
  return {
    consumeRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
    reserveGuildQuota: async () => ({ allowed: true, retryAfterMs: 0 }),
    settleGuildQuota: async (_guildKey, _requestId, actual) => actual,
    acquireConcurrency: async () => true,
    releaseConcurrency: async () => undefined,
  };
}

const request: AiCodeExecutionRequest = {
  input: 'Pythonを実行してPNGグラフを作って',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
  artifactConfig: { maxBytes: 8, maxFiles: 2 },
};

function containerResponse() {
  return Response.json({
    id: 'cntr_test',
    memory_limit: '1g',
    network_policy: { type: 'disabled' },
  });
}

function executionResponse(annotations: Array<Record<string, unknown>>) {
  return Response.json({
    status: 'completed',
    output: [
      { type: 'code_interpreter_call', id: 'ci_1', status: 'completed' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'PNGを生成しました。',
            annotations,
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}

function annotation(fileId: string, filename: string) {
  return {
    type: 'container_file_citation',
    container_id: 'cntr_test',
    file_id: fileId,
    filename,
  };
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function service(fetchImpl: typeof fetch) {
  return new OpenAiCodeExecutionService({
    baseConfig: resolveAiFoundationConfig({ HERTA_AI_ENABLED: 'true' }),
    apiKey: 'server-secret',
    guardStore: guardStore(),
    runtimeResolver: resolver(),
    fetchImpl,
    now: () => Date.parse('2026-08-29T06:00:00Z'),
  });
}

describe('OpenAiCodeExecutionService binary artifacts', () => {
  it('PNGはtext上限/UTF-8 validationを適用せずbounded binaryとして取得する', async () => {
    const binary = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x01, 0x02,
    ]);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse([annotation('cfile_1', 'chart.png')]);
      if (url.endsWith('/files/cfile_1/content')) {
        return new Response(binary, { headers: { 'content-type': 'image/png' } });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    const result = await service(fetchImpl).execute(request);

    expect(result.sandboxDestroyed).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      filename: 'chart.png',
      mimeType: 'image/png',
      kind: 'image',
    });
    expect(result.files[0]?.bytes).toEqual(binary);
  });

  it('複数image citationはdownload前にrejectする', async () => {
    let downloads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) {
        return executionResponse([annotation('cfile_1', 'a.png'), annotation('cfile_2', 'b.webp')]);
      }
      if (url.includes('/files/')) {
        downloads += 1;
        return new Response(new Uint8Array([1]));
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    await expect(service(fetchImpl).execute(request)).rejects.toMatchObject({
      category: 'output_limit_exceeded',
    });
    expect(downloads).toBe(0);
  });

  it('image declared MIME mismatchはrejectする', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/containers') && init?.method === 'POST') return containerResponse();
      if (url.endsWith('/responses')) return executionResponse([annotation('cfile_1', 'chart.png')]);
      if (url.endsWith('/files/cfile_1/content')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/webp' },
        });
      }
      if (url.endsWith('/containers/cntr_test') && init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });

    await expect(service(fetchImpl).execute(request)).rejects.toMatchObject({
      category: 'artifact_download_failed',
    });
  });
});
