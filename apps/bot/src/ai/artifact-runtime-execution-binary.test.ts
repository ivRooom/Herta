import sharp from 'sharp';
import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import type { AiCodeExecutionResult, AiCodeExecutionService } from './code-execution-service.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const artifactConfig = { maxBytes: 4096, maxFiles: 3 };
const request = {
  input: 'このPythonを実行してグラフPNGを作って',
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

async function png(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 64, height: 32, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
}

function executionService(result: AiCodeExecutionResult): AiCodeExecutionService {
  return { execute: vi.fn(async () => result) };
}

function executionResult(bytes: Uint8Array): AiCodeExecutionResult {
  return {
    requestId: 'request-1',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    estimatedCost: 0.0301,
    durationMs: 42,
    summary: 'グラフPNGを生成しました。',
    files: [{ filename: 'chart.png', mimeType: 'image/png', bytes, kind: 'image' }],
    sandboxDestroyed: true,
    pricingVerifiedAt: '2026-08-27',
  };
}

describe('AiArtifactRuntime binary execution artifact', () => {
  it('Code Interpreter生成PNGをvalidated image artifactとして返す', async () => {
    const events: unknown[] = [];
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(executionResult(await png())),
      artifactConfig,
      telemetry: (event) => {
        events.push(event);
      },
    });

    const result = await runtime.prepare(request);

    expect(result.status).toBe('executed');
    if (result.status !== 'executed') throw new Error('expected executed result');
    expect(result.artifacts[0]).toMatchObject({
      filename: 'chart.png',
      mimeType: 'image/png',
      kind: 'image',
      metadata: { width: 64, height: 32, pixels: 2048 },
    });
    expect(events[0]).toMatchObject({
      intent: 'code_execution',
      resultCategory: 'success',
      executionStatus: 'success',
      artifactCount: 1,
      artifacts: [{ kind: 'image', mimeType: 'image/png' }],
    });
  });

  it('malformed binaryをsuccess扱いしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      executionService: executionService(
        executionResult(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])),
      ),
      artifactConfig,
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'validation_failed' });
  });
});
