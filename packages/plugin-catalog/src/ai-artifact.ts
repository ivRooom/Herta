export const AI_ARTIFACT_INTENTS = [
  'chat',
  'code_artifact',
  'code_execution',
  'image_generation',
  'file_artifact',
  'detailed_answer',
] as const;

export type AiArtifactIntent = (typeof AI_ARTIFACT_INTENTS)[number];

export const AI_ARTIFACT_KINDS = ['code', 'document', 'data', 'image', 'file'] as const;
export type AiArtifactKind = (typeof AI_ARTIFACT_KINDS)[number];

export const AI_ARTIFACT_DEFAULTS = {
  maxBytes: 512 * 1024,
  maxFiles: 3,
} as const;

export interface AiArtifactConfig {
  maxBytes: number;
  maxFiles: number;
}

export interface AiArtifactMetadata {
  [key: string]: string | number | boolean;
}

export interface AiArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  size: number;
  kind: AiArtifactKind;
  metadata?: AiArtifactMetadata;
}

export interface AiArtifactDraft {
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
  kind: AiArtifactKind;
  metadata?: AiArtifactMetadata;
}

export type AiArtifactValidationErrorCode =
  | 'invalid_filename'
  | 'unsupported_extension'
  | 'unsupported_mime'
  | 'mime_extension_mismatch'
  | 'artifact_too_large'
  | 'too_many_files'
  | 'invalid_content';

export class AiArtifactValidationError extends Error {
  readonly code: AiArtifactValidationErrorCode;

  constructor(code: AiArtifactValidationErrorCode) {
    super(`AI artifact validation failed: ${code}`);
    this.name = 'AiArtifactValidationError';
    this.code = code;
  }
}

const MIME_BY_EXTENSION = {
  '.py': 'text/x-python',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.csv': 'text/csv',
} as const;

type SupportedExtension = keyof typeof MIME_BY_EXTENSION;
type SupportedMimeType = (typeof MIME_BY_EXTENSION)[SupportedExtension];

const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function resolveAiArtifactConfig(
  env: Record<string, string | undefined> = process.env,
): AiArtifactConfig {
  return {
    maxBytes: boundedInteger(
      env['HERTA_AI_ARTIFACT_MAX_BYTES'],
      AI_ARTIFACT_DEFAULTS.maxBytes,
      1024,
      8 * 1024 * 1024,
    ),
    maxFiles: boundedInteger(env['HERTA_AI_ARTIFACT_MAX_FILES'], AI_ARTIFACT_DEFAULTS.maxFiles, 1, 5),
  };
}

export function resolveAiArtifactIntent(input: string): AiArtifactIntent {
  const normalized = normalizeIntentInput(input);
  if (!normalized) return 'chat';

  const executionRequested =
    /(実行|動かして|走らせて|計算して|変換して|run\b|execute\b|execution\b)/i.test(normalized);
  const codeRequested =
    /(python|py\b|typescript|javascript|java\b|golang|\bgo\b|rust|c#|コード|スクリプト|program|source code)/i.test(
      normalized,
    );
  if (executionRequested && codeRequested) return 'code_execution';

  const creationRequested = /(書いて|作って|生成して|出力して|create\b|write\b|generate\b|make\b)/i.test(
    normalized,
  );
  const imageRequested = /(画像|イラスト|image\b|picture\b|png\b|webp\b)/i.test(normalized);
  if (creationRequested && imageRequested) return 'image_generation';

  if (creationRequested && codeRequested) return 'code_artifact';

  const fileRequested =
    /(markdown|readme|\.md\b|json\b|yaml\b|yml\b|csv\b|txt\b|テキスト|ファイル)/i.test(
      normalized,
    );
  if (creationRequested && fileRequested) return 'file_artifact';

  if (/(詳しく|詳細に|丁寧に|step[- ]by[- ]step|in detail|detailed)/i.test(normalized)) {
    return 'detailed_answer';
  }

  return 'chat';
}

export function validateAiArtifactBatch(
  drafts: readonly AiArtifactDraft[],
  config: AiArtifactConfig,
): AiArtifact[] {
  if (!Array.isArray(drafts) || drafts.length < 1) {
    throw new AiArtifactValidationError('invalid_content');
  }
  if (drafts.length > config.maxFiles) {
    throw new AiArtifactValidationError('too_many_files');
  }
  return drafts.map((draft) => validateAiArtifact(draft, config));
}

export function validateAiArtifact(
  draft: AiArtifactDraft,
  config: AiArtifactConfig,
): AiArtifact {
  const filename = normalizeArtifactFilename(draft.filename);
  const extension = extensionOf(filename);
  if (!isSupportedExtension(extension)) {
    throw new AiArtifactValidationError('unsupported_extension');
  }

  const mimeType = normalizeMimeType(draft.mimeType);
  if (!isSupportedMimeType(mimeType)) {
    throw new AiArtifactValidationError('unsupported_mime');
  }
  if (MIME_BY_EXTENSION[extension] !== mimeType) {
    throw new AiArtifactValidationError('mime_extension_mismatch');
  }

  if (!(typeof draft.content === 'string' || draft.content instanceof Uint8Array)) {
    throw new AiArtifactValidationError('invalid_content');
  }
  const bytes =
    typeof draft.content === 'string'
      ? new TextEncoder().encode(draft.content)
      : new Uint8Array(draft.content);
  if (bytes.byteLength > config.maxBytes) {
    throw new AiArtifactValidationError('artifact_too_large');
  }

  return {
    filename,
    mimeType,
    bytes,
    size: bytes.byteLength,
    kind: draft.kind,
    ...(draft.metadata ? { metadata: { ...draft.metadata } } : {}),
  };
}

export function normalizeArtifactFilename(value: string): string {
  if (typeof value !== 'string') throw new AiArtifactValidationError('invalid_filename');
  const filename = value.normalize('NFKC').trim();
  if (!filename || filename.length > 128) {
    throw new AiArtifactValidationError('invalid_filename');
  }
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    /[\u0000-\u001f\u007f]/u.test(filename) ||
    /[:*?"<>|]/u.test(filename) ||
    /%(?:2f|5c)/i.test(filename) ||
    filename.startsWith('.') ||
    /[. ]$/u.test(filename)
  ) {
    throw new AiArtifactValidationError('invalid_filename');
  }

  const baseName = filename.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    throw new AiArtifactValidationError('invalid_filename');
  }
  return filename;
}

export function mimeTypeForArtifactFilename(filename: string): string | null {
  const extension = extensionOf(normalizeArtifactFilename(filename));
  return isSupportedExtension(extension) ? MIME_BY_EXTENSION[extension] : null;
}

function normalizeIntentInput(input: string): string {
  return typeof input === 'string' ? input.normalize('NFKC').trim() : '';
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot).toLowerCase();
}

function normalizeMimeType(value: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isSupportedExtension(value: string): value is SupportedExtension {
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, value);
}

function isSupportedMimeType(value: string): value is SupportedMimeType {
  return Object.values(MIME_BY_EXTENSION).includes(value as SupportedMimeType);
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}
