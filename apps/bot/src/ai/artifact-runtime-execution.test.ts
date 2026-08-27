import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import type {
  AiCodeExecutionRequest,
  AiCodeExecutionResult,
  AiCodeExecutionService,
} from './code-execution-service.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const artifactConfig = { maxBytes: 4096, maxFiles: 2 };
const request = {
  input: 'このPythonコードを実行してCSVにして',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

function generationService(): AiRuntimeGenerationService {
  return {
    generate: vi.fn(async (): Promise<AiGenerationResponse> => {
      throw new Error('generation service must not be used for code execution');
    }),
  };
}

function executionResult(overrides: Partial<AiCodeExecutionResult> = {}): AiCodeExecutionResult {
  const csv = new TextEncoder().encode('name,value\na,1\n');
  return {
    requestId: 'request-1',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    estimatedCost: 0.0301,
    durationMs: 42,
    summary: 'CSVを生成しました。',
    files: [{ filename: 'result.csv', mimeType: 'text/csv', bytes: csv, kind: 'data' }],
    sandboxDestroyed: true,
    pricingVerifiedAt: '2026-08-27',
    ...overrides,
  };
}

function executionService(
  result: AiCodeExecutionResult,
  requests: AiCodeExecutionRequest[] = [],
): AiCodeExecutionService {
  return {
    execute: vi.fn(async (executionRequest) => {
      requests.push(executionRequest);
      return result;
    }),
  };
}

describe('AiArtifactRuntime Phase 2 execution', () => {
  it('明示executionだけsandbox serviceへrouteし、CSVを既存Artifact validationへ通す', async () => {
    const executionRequests: AiCodeExecutionRequest[] = [];
    const generate = generationService();
    const runtime = new AiArtifactRuntime({
      generationService: generate,
      executionService: executionService(executionResult(), executionRequests),
      artifactConfig,
    });

    const result = await runtime.prepare(request);

    expect(result.status).toBe('executed');
    if (result.status !== 'executed') throw new Error('expected executed result');
    expect(result.intent).toBe('code_execution');
    expect(result.summary).toBe('CSVを生成しました。');
    expect(result.artifacts[0]?.filename).toBe('result.csv');
    expect(new TextDecoder().decode(result.artifacts[0]?.bytes)).toBe('name,value\na,1\n');
    expect(executionRequests).toHaveLength(1);
    expect(executionRequests[0]?.artifactConfig).toEqual(artifactConfig);
    expect(generate.generate).not.toHaveBeenCalled();
  });

  it('execution service未構成ならfail closedして未実行を明示する', async () => {
    const runtime = new AiArtifactRuntime({ generationService: generationService(), artifactConfig });

    const result = await runtime.prepare(request);

    expect(result).toMatchObject({ status: 'unsupported', intent: 'code_execution' });
    if (result.status !== 'unsupported') throw new Error('expected unsupported result');
    expect(result.userMessage).toContain('実行していません');
  });

  it('execution生成fileのunsafe filenameを成功扱いにしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(
        executionResult({
          files: [
            {
              filename: '../result.csv',
              mimeType: 'text/csv',
              bytes: new TextEncoder().encode('a,b\n1,2\n'),
              kind: 'data',
            },
          ],
        }),
      ),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'validation_failed' });
  });

  it('execution生成fileのMIME mismatchを成功扱いにしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(
        executionResult({
          files: [
            {
              filename: 'result.csv',
              mimeType: 'application/json',
              bytes: new TextEncoder().encode('a,b\n1,2\n'),
              kind: 'data',
            },
          ],
        }),
      ),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'validation_failed' });
  });

  it('execution生成fileのoversizeを成功扱いにしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(
        executionResult({
          files: [
            {
              filename: 'result.csv',
              mimeType: 'text/csv',
              bytes: new TextEncoder().encode('x'.repeat(4097)),
              kind: 'data',
            },
          ],
        }),
      ),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'validation_failed' });
  });

  it('execution telemetryへraw source/output/prompt/filename/secretを含めない', async () => {
    const events: unknown[] = [];
    const rawOutput = 'SECRET-RAW-OUTPUT';
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(
        executionResult({
          summary: '処理完了',
          files: [
            {
              filename: 'private-secret-name.csv',
              mimeType: 'text/csv',
              bytes: new TextEncoder().encode(rawOutput),
              kind: 'data',
            },
          ],
        }),
      ),
      artifactConfig,
      telemetry: (event) => {
        events.push(event);
      },
    });

    await runtime.prepare({ ...request, input: 'PRIVATE-RAW-PROMPT server-secret を実行して' });

    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('PRIVATE-RAW-PROMPT');
    expect(serialized).not.toContain(rawOutput);
    expect(serialized).not.toContain('private-secret-name.csv');
    expect(serialized).not.toContain('server-secret');
    expect(events[0]).toMatchObject({
      intent: 'code_execution',
      resultCategory: 'success',
      executionStatus: 'success',
      artifactCount: 1,
      durationMs: 42,
      provider: 'openai',
      model: 'gpt-5.6-terra',
      artifacts: [{ kind: 'data', mimeType: 'text/csv', size: rawOutput.length }],
    });
  });
});
