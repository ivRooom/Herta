import {
  mimeTypeForArtifactFilename,
  normalizeArtifactFilename,
  validateAiArtifact,
  type AiArtifact,
  type AiArtifactConfig,
  type AiArtifactKind,
} from '@herta/plugin-catalog/ai-artifact';
import {
  AI_IMAGE_ARTIFACT_DEFAULTS,
  validateAiImageArtifact,
} from './image-artifact-validation.js';

export type AiExecutionArtifactValidationErrorCode =
  'unsupported_type' | 'invalid_batch' | 'too_many_images';

export class AiExecutionArtifactValidationError extends Error {
  readonly code: AiExecutionArtifactValidationErrorCode;

  constructor(code: AiExecutionArtifactValidationErrorCode) {
    super(`AI execution artifact validation failed: ${code}`);
    this.name = 'AiExecutionArtifactValidationError';
    this.code = code;
  }
}

export interface AiExecutionArtifactDownloadPolicy {
  filename: string;
  mimeType: string;
  kind: AiArtifactKind;
  maxBytes: number;
  requiresUtf8: boolean;
}

export interface AiExecutionArtifactDraft {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  kind: AiArtifactKind;
}

export function resolveAiExecutionArtifactDownloadPolicy(
  rawFilename: string,
  artifactConfig: AiArtifactConfig,
): AiExecutionArtifactDownloadPolicy {
  const filename = normalizeArtifactFilename(rawFilename);
  const textMimeType = mimeTypeForArtifactFilename(filename);
  if (textMimeType) {
    return {
      filename,
      mimeType: textMimeType,
      kind: artifactKindForTextFilename(filename),
      maxBytes: artifactConfig.maxBytes,
      requiresUtf8: true,
    };
  }

  const imageMimeType = imageMimeTypeForFilename(filename);
  if (imageMimeType) {
    return {
      filename,
      mimeType: imageMimeType,
      kind: 'image',
      maxBytes: AI_IMAGE_ARTIFACT_DEFAULTS.maxBytes,
      requiresUtf8: false,
    };
  }

  throw new AiExecutionArtifactValidationError('unsupported_type');
}

export async function validateAiExecutionArtifactBatch(
  drafts: readonly AiExecutionArtifactDraft[],
  artifactConfig: AiArtifactConfig,
): Promise<AiArtifact[]> {
  if (!Array.isArray(drafts) || drafts.length > artifactConfig.maxFiles) {
    throw new AiExecutionArtifactValidationError('invalid_batch');
  }

  const imageCount = drafts.filter((draft) => draft.kind === 'image').length;
  if (imageCount > AI_IMAGE_ARTIFACT_DEFAULTS.maxFiles) {
    throw new AiExecutionArtifactValidationError('too_many_images');
  }

  return Promise.all(
    drafts.map((draft) =>
      draft.kind === 'image'
        ? validateAiImageArtifact({
            filename: draft.filename,
            mimeType: draft.mimeType,
            bytes: draft.bytes,
          })
        : Promise.resolve(
            validateAiArtifact(
              {
                filename: draft.filename,
                mimeType: draft.mimeType,
                content: draft.bytes,
                kind: draft.kind,
              },
              artifactConfig,
            ),
          ),
    ),
  );
}

export function isAiExecutionImageArtifactPolicy(
  policy: AiExecutionArtifactDownloadPolicy,
): boolean {
  return policy.kind === 'image';
}

function imageMimeTypeForFilename(filename: string): 'image/png' | 'image/webp' | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function artifactKindForTextFilename(filename: string): AiArtifactKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.py')) return 'code';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'document';
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.csv')
  ) {
    return 'data';
  }
  return 'file';
}
