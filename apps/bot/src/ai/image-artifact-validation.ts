import sharp from 'sharp';
import { normalizeArtifactFilename, type AiArtifact } from '@herta/plugin-catalog/ai-artifact';

export const AI_IMAGE_ARTIFACT_DEFAULTS = {
  maxBytes: 4 * 1024 * 1024,
  maxFiles: 1,
  maxWidth: 2048,
  maxHeight: 2048,
  maxPixels: 4_194_304,
} as const;

export interface AiImageArtifactConfig {
  maxBytes: number;
  maxFiles: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
}

export interface AiImageArtifactDraft {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type AiImageArtifactValidationErrorCode =
  | 'invalid_content'
  | 'artifact_too_large'
  | 'too_many_files'
  | 'unsupported_image_type'
  | 'mime_extension_mismatch'
  | 'invalid_dimensions'
  | 'dimension_limit_exceeded'
  | 'pixel_limit_exceeded'
  | 'malformed_image';

export class AiImageArtifactValidationError extends Error {
  readonly code: AiImageArtifactValidationErrorCode;

  constructor(code: AiImageArtifactValidationErrorCode) {
    super(`AI image artifact validation failed: ${code}`);
    this.name = 'AiImageArtifactValidationError';
    this.code = code;
  }
}

const IMAGE_MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.webp': 'image/webp',
} as const;

type ImageMime = (typeof IMAGE_MIME_BY_EXTENSION)[keyof typeof IMAGE_MIME_BY_EXTENSION];

export async function validateAiImageArtifactBatch(
  drafts: readonly AiImageArtifactDraft[],
  config: AiImageArtifactConfig = AI_IMAGE_ARTIFACT_DEFAULTS,
): Promise<AiArtifact[]> {
  assertValidConfig(config);
  if (!Array.isArray(drafts) || drafts.length < 1) {
    throw new AiImageArtifactValidationError('invalid_content');
  }
  if (drafts.length > config.maxFiles) {
    throw new AiImageArtifactValidationError('too_many_files');
  }
  return Promise.all(drafts.map((draft) => validateAiImageArtifact(draft, config)));
}

export async function validateAiImageArtifact(
  draft: AiImageArtifactDraft,
  config: AiImageArtifactConfig = AI_IMAGE_ARTIFACT_DEFAULTS,
): Promise<AiArtifact> {
  assertValidConfig(config);
  const filename = normalizeArtifactFilename(draft.filename);
  const mimeType = normalizeMime(draft.mimeType);
  const extension = extensionOf(filename);
  const expectedMime = IMAGE_MIME_BY_EXTENSION[extension as keyof typeof IMAGE_MIME_BY_EXTENSION];
  if (!expectedMime || !isImageMime(mimeType)) {
    throw new AiImageArtifactValidationError('unsupported_image_type');
  }
  if (mimeType !== expectedMime) {
    throw new AiImageArtifactValidationError('mime_extension_mismatch');
  }
  if (!(draft.bytes instanceof Uint8Array) || draft.bytes.byteLength < 1) {
    throw new AiImageArtifactValidationError('invalid_content');
  }
  if (draft.bytes.byteLength > config.maxBytes) {
    throw new AiImageArtifactValidationError('artifact_too_large');
  }

  const bytes = new Uint8Array(draft.bytes);
  const sniffedMime = sniffImageMime(bytes);
  if (!sniffedMime) throw new AiImageArtifactValidationError('unsupported_image_type');
  if (sniffedMime !== mimeType) {
    throw new AiImageArtifactValidationError('mime_extension_mismatch');
  }

  const inputOptions = {
    failOn: 'warning' as const,
    limitInputPixels: config.maxPixels,
    limitInputChannels: 4,
    sequentialRead: true,
  };

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(Buffer.from(bytes), inputOptions).metadata();
  } catch {
    throw new AiImageArtifactValidationError('malformed_image');
  }

  const width = metadata.width;
  const height = metadata.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    (width ?? 0) <= 0 ||
    (height ?? 0) <= 0
  ) {
    throw new AiImageArtifactValidationError('invalid_dimensions');
  }
  if (width! > config.maxWidth || height! > config.maxHeight) {
    throw new AiImageArtifactValidationError('dimension_limit_exceeded');
  }
  const pixels = width! * height!;
  if (!Number.isSafeInteger(pixels) || pixels > config.maxPixels) {
    throw new AiImageArtifactValidationError('pixel_limit_exceeded');
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new AiImageArtifactValidationError('malformed_image');
  }
  if (metadata.format !== formatForMime(mimeType)) {
    throw new AiImageArtifactValidationError('mime_extension_mismatch');
  }

  // metadata() only reads enough of the header to identify the image. Decode the complete image
  // under the same pixel/channel limits so truncated payloads and decoder warnings fail closed.
  try {
    await sharp(Buffer.from(bytes), inputOptions).raw().toBuffer();
  } catch {
    throw new AiImageArtifactValidationError('malformed_image');
  }

  return {
    filename,
    mimeType,
    bytes,
    size: bytes.byteLength,
    kind: 'image',
    metadata: { width: width!, height: height!, pixels },
  };
}

export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}

function normalizeMime(value: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isImageMime(value: string): value is ImageMime {
  return value === 'image/png' || value === 'image/webp';
}

function formatForMime(mimeType: ImageMime): 'png' | 'webp' {
  return mimeType === 'image/png' ? 'png' : 'webp';
}

function assertValidConfig(config: AiImageArtifactConfig): void {
  if (!Number.isSafeInteger(config.maxWidth * config.maxHeight)) {
    throw new AiImageArtifactValidationError('invalid_content');
  }
  for (const value of [
    config.maxBytes,
    config.maxFiles,
    config.maxWidth,
    config.maxHeight,
    config.maxPixels,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new AiImageArtifactValidationError('invalid_content');
    }
  }
}
