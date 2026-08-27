import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_ARTIFACT_DEFAULTS,
  AiImageArtifactValidationError,
  validateAiImageArtifact,
} from './image-artifact-validation.js';

async function png(width = 64, height = 64): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
}

interface SharpWebpFixtureEncoder {
  webp(options?: { lossless?: boolean }): { toBuffer(): Promise<Buffer> };
}

async function webp(width = 64, height = 64): Promise<Uint8Array> {
  const encoder = sharp({
    create: { width, height, channels: 4, background: { r: 32, g: 64, b: 96, alpha: 1 } },
  }) as unknown as SharpWebpFixtureEncoder;
  return new Uint8Array(await encoder.webp({ lossless: true }).toBuffer());
}

function animatedWebpHeader(): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set([22, 0, 0, 0], 4);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode('VP8X'), 12);
  bytes.set([10, 0, 0, 0], 16);
  bytes[20] = 0x02;
  return bytes;
}

describe('AI image artifact validation', () => {
  it('valid PNGをmagic byte + full decode後に受理する', async () => {
    const artifact = await validateAiImageArtifact({
      filename: 'generated-image.png',
      mimeType: 'image/png',
      bytes: await png(),
    });
    expect(artifact).toMatchObject({
      filename: 'generated-image.png',
      mimeType: 'image/png',
      kind: 'image',
      metadata: { width: 64, height: 64, pixels: 4096 },
    });
  });

  it('valid WebPを受理する', async () => {
    const artifact = await validateAiImageArtifact({
      filename: 'generated-image.webp',
      mimeType: 'image/webp',
      bytes: await webp(),
    });
    expect(artifact).toMatchObject({ mimeType: 'image/webp', kind: 'image' });
  });

  it('animated WebPをdecoder前にrejectする', async () => {
    await expect(
      validateAiImageArtifact({
        filename: 'animated.webp',
        mimeType: 'image/webp',
        bytes: animatedWebpHeader(),
      }),
    ).rejects.toMatchObject({ code: 'malformed_image' });
  });

  it('MIME spoof / extension mismatchをrejectする', async () => {
    await expect(
      validateAiImageArtifact({
        filename: 'spoof.webp',
        mimeType: 'image/webp',
        bytes: await png(),
      }),
    ).rejects.toMatchObject({ code: 'mime_extension_mismatch' });
  });

  it('unsafe filename/path traversalをrejectする', async () => {
    await expect(
      validateAiImageArtifact({
        filename: '../generated-image.png',
        mimeType: 'image/png',
        bytes: await png(),
      }),
    ).rejects.toMatchObject({ name: 'AiArtifactValidationError' });
  });

  it('bad magic bytesをrejectする', async () => {
    await expect(
      validateAiImageArtifact({
        filename: 'bad.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_image_type' });
  });

  it('truncated PNGをfull decodeでrejectする', async () => {
    const valid = await png();
    const truncated = valid.slice(0, Math.max(8, Math.floor(valid.length / 2)));
    await expect(
      validateAiImageArtifact({
        filename: 'truncated.png',
        mimeType: 'image/png',
        bytes: truncated,
      }),
    ).rejects.toMatchObject({ code: 'malformed_image' });
  });

  it('max bytes超過をdecoder前にrejectする', async () => {
    const bytes = new Uint8Array(AI_IMAGE_ARTIFACT_DEFAULTS.maxBytes + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      validateAiImageArtifact({
        filename: 'oversized.png',
        mimeType: 'image/png',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'artifact_too_large' });
  });

  it('dimension limit超過をrejectする', async () => {
    await expect(
      validateAiImageArtifact({
        filename: 'wide.png',
        mimeType: 'image/png',
        bytes: await png(2064, 16),
      }),
    ).rejects.toMatchObject({ code: 'dimension_limit_exceeded' });
  });

  it('pixel limit超過をrejectする', async () => {
    await expect(
      validateAiImageArtifact(
        {
          filename: 'pixels.png',
          mimeType: 'image/png',
          bytes: await png(64, 64),
        },
        { ...AI_IMAGE_ARTIFACT_DEFAULTS, maxPixels: 2048 },
      ),
    ).rejects.toMatchObject({ code: 'pixel_limit_exceeded' });
  });

  it('zero / malformed dimensionsをsuccess扱いしない', async () => {
    const onlySignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(
      validateAiImageArtifact({
        filename: 'zero.png',
        mimeType: 'image/png',
        bytes: onlySignature,
      }),
    ).rejects.toBeInstanceOf(AiImageArtifactValidationError);
  });
});
