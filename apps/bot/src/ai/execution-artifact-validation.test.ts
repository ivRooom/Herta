import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AiExecutionArtifactValidationError,
  resolveAiExecutionArtifactDownloadPolicy,
  validateAiExecutionArtifactBatch,
} from './execution-artifact-validation.js';
import { AI_IMAGE_ARTIFACT_DEFAULTS } from './image-artifact-validation.js';

const artifactConfig = { maxBytes: 4096, maxFiles: 3 };

async function png(width = 64, height = 64): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
}

describe('AI execution artifact validation', () => {
  it('text成果物は既存artifact上限とUTF-8 validationを維持する', () => {
    expect(resolveAiExecutionArtifactDownloadPolicy('result.csv', artifactConfig)).toEqual({
      filename: 'result.csv',
      mimeType: 'text/csv',
      kind: 'data',
      maxBytes: 4096,
      requiresUtf8: true,
    });
  });

  it('PNG/WebPだけbinary download policyへ許可する', () => {
    expect(resolveAiExecutionArtifactDownloadPolicy('chart.png', artifactConfig)).toEqual({
      filename: 'chart.png',
      mimeType: 'image/png',
      kind: 'image',
      maxBytes: AI_IMAGE_ARTIFACT_DEFAULTS.maxBytes,
      requiresUtf8: false,
    });
    expect(resolveAiExecutionArtifactDownloadPolicy('chart.webp', artifactConfig)).toMatchObject({
      mimeType: 'image/webp',
      kind: 'image',
      requiresUtf8: false,
    });
  });

  it('未許可binary extensionはfail closedする', () => {
    expect(() => resolveAiExecutionArtifactDownloadPolicy('archive.zip', artifactConfig)).toThrow(
      AiExecutionArtifactValidationError,
    );
  });

  it('Code Interpreter生成PNGを既存magic/dimension/full-decode validatorへ通す', async () => {
    const bytes = await png();
    const artifacts = await validateAiExecutionArtifactBatch(
      [{ filename: 'chart.png', mimeType: 'image/png', bytes, kind: 'image' }],
      artifactConfig,
    );

    expect(artifacts[0]).toMatchObject({
      filename: 'chart.png',
      mimeType: 'image/png',
      kind: 'image',
      metadata: { width: 64, height: 64, pixels: 4096 },
    });
  });

  it('MIME spoofされたexecution imageをrejectする', async () => {
    await expect(
      validateAiExecutionArtifactBatch(
        [{ filename: 'chart.webp', mimeType: 'image/webp', bytes: await png(), kind: 'image' }],
        artifactConfig,
      ),
    ).rejects.toMatchObject({ code: 'mime_extension_mismatch' });
  });

  it('execution imageは1requestあたり1fileまでに制限する', async () => {
    const bytes = await png();
    await expect(
      validateAiExecutionArtifactBatch(
        [
          { filename: 'a.png', mimeType: 'image/png', bytes, kind: 'image' },
          { filename: 'b.png', mimeType: 'image/png', bytes, kind: 'image' },
        ],
        artifactConfig,
      ),
    ).rejects.toMatchObject({ code: 'too_many_images' });
  });
});
