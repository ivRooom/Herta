import type { AiGenerationResponse } from '@herta/plugin-catalog/ai-service';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { AiArtifactRuntime } from './artifact-runtime.js';
import { AiImageGenerationError } from './image-generation-service.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

function generationService(): AiRuntimeGenerationService {
  return {
    generate: vi.fn(async () => {
      const response: AiGenerationResponse = {
        requestId: 'unused',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        text: 'unused',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        estimatedCost: 0,
      };
      return response;
    }),
  };
}

async function validPng(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
}

const request = {
  input: 'PRIVATE-RAW-PROMPT 猫の画像を生成して',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

describe('AiArtifactRuntime image generation', () => {
  it('image_generationを実provider capabilityへ接続しvalidated image artifactだけをreadyにする', async () => {
    const bytes = await validPng();
    const imageGenerationService = {
      generate: vi.fn(async () => ({
        requestId: 'image-request-1',
        provider: 'openai' as const,
        model: 'gpt-5.6-terra' as const,
        imageBillingModel: 'gpt-image-2' as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        estimatedCost: 0.0061,
        durationMs: 25,
        pricingVerifiedAt: '2026-08-27',
        file: {
          filename: 'generated-image.png' as const,
          mimeType: 'image/png' as const,
          bytes,
        },
      })),
    };
    const fallbackGeneration = generationService();
    const runtime = new AiArtifactRuntime({
      generationService: fallbackGeneration,
      imageGenerationService,
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });

    const result = await runtime.prepare(request);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected image artifact');
    expect(result.intent).toBe('image_generation');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      filename: 'generated-image.png',
      mimeType: 'image/png',
      kind: 'image',
      metadata: { width: 64, height: 64, pixels: 4096 },
    });
    expect(imageGenerationService.generate).toHaveBeenCalledTimes(1);
    expect(fallbackGeneration.generate).not.toHaveBeenCalled();
  });

  it('malformed imageをvalidation failureにしreadyを返さない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      imageGenerationService: {
        generate: vi.fn(async () => ({
          requestId: 'image-request-1',
          provider: 'openai' as const,
          model: 'gpt-5.6-terra' as const,
          imageBillingModel: 'gpt-image-2' as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          estimatedCost: 0.0061,
          durationMs: 25,
          pricingVerifiedAt: '2026-08-27',
          file: {
            filename: 'generated-image.png' as const,
            mimeType: 'image/png' as const,
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          },
        })),
      },
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'validation_failed' });
  });

  it('provider failure taxonomyを保持しfake successにしない', async () => {
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      imageGenerationService: {
        generate: vi.fn(async () => {
          throw new AiImageGenerationError('tool_not_invoked');
        }),
      },
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
    });

    await expect(runtime.prepare(request)).rejects.toMatchObject({ category: 'tool_not_invoked' });
  });

  it('telemetryへraw prompt / image bytes / base64 / filenameを出さない', async () => {
    const events: unknown[] = [];
    const bytes = await validPng();
    const base64 = Buffer.from(bytes).toString('base64');
    const runtime = new AiArtifactRuntime({
      generationService: generationService(),
      imageGenerationService: {
        generate: vi.fn(async () => ({
          requestId: 'image-request-1',
          provider: 'openai' as const,
          model: 'gpt-5.6-terra' as const,
          imageBillingModel: 'gpt-image-2' as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          estimatedCost: 0.0061,
          durationMs: 25,
          pricingVerifiedAt: '2026-08-27',
          file: {
            filename: 'generated-image.png' as const,
            mimeType: 'image/png' as const,
            bytes,
          },
        })),
      },
      artifactConfig: { maxBytes: 4096, maxFiles: 2 },
      telemetry: (event) => {
        events.push(event);
      },
    });

    await runtime.prepare(request);

    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('PRIVATE-RAW-PROMPT');
    expect(serialized).not.toContain('generated-image.png');
    expect(serialized).not.toContain(base64);
    expect(events[0]).toMatchObject({
      intent: 'image_generation',
      resultCategory: 'success',
      imageGenerationStatus: 'success',
      artifactCount: 1,
      artifacts: [{ kind: 'image', mimeType: 'image/png', size: bytes.byteLength }],
    });
  });
});
