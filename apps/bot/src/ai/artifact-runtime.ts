import {
  isPythonCodeArtifactRequest,
  resolveAiArtifactIntent,
  validateAiArtifactBatch,
  type AiArtifact,
  type AiArtifactConfig,
  type AiArtifactDraft,
  type AiArtifactIntent,
} from '@herta/plugin-catalog/ai-artifact';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationService } from './runtime-service.js';

export type AiArtifactRuntimeErrorCategory =
  | 'malformed_generation'
  | 'validation_failed'
  | 'internal_error';

export class AiArtifactRuntimeError extends Error {
  readonly category: AiArtifactRuntimeErrorCategory;
  readonly userMessage = '成果物を安全に生成できませんでした。';

  constructor(category: AiArtifactRuntimeErrorCategory) {
    super(`AI artifact runtime failed: ${category}`);
    this.name = 'AiArtifactRuntimeError';
    this.category = category;
  }
}

export type AiArtifactRuntimeResult =
  | {
      status: 'not_handled';
      intent: 'chat' | 'detailed_answer';
    }
  | {
      status: 'unsupported';
      intent: 'code_artifact' | 'code_execution' | 'image_generation';
      userMessage: string;
    }
  | {
      status: 'ready';
      intent: 'code_artifact' | 'file_artifact';
      artifacts: AiArtifact[];
    };

export interface AiArtifactRuntimeRequest {
  input: string;
  guildId: string;
  scopeGuildId: string;
  userId: string;
  authorized: boolean;
  pluginEnabled: boolean;
  guildOptIn: boolean;
}

export interface AiArtifactTelemetryArtifact {
  kind: AiArtifact['kind'];
  mimeType: string;
  size: number;
}

export interface AiArtifactTelemetryEvent {
  intent: AiArtifactIntent;
  resultCategory: 'success' | 'rejected' | 'failed' | 'not_handled';
  artifactCount: number;
  totalBytes: number;
  artifacts: AiArtifactTelemetryArtifact[];
  errorCategory: AiArtifactRuntimeErrorCategory | 'foundation_error' | null;
}

export type AiArtifactTelemetrySink = (
  event: AiArtifactTelemetryEvent,
) => void | Promise<void>;

export interface AiArtifactRuntimeOptions {
  generationService: AiRuntimeGenerationService;
  artifactConfig: AiArtifactConfig;
  telemetry?: AiArtifactTelemetrySink;
}

const CODE_ARTIFACT_INSTRUCTION = [
  'This is a code artifact request. Generate source code only; do not execute it and do not claim execution.',
  'Return exactly one JSON object and no Markdown fences or surrounding prose.',
  'The JSON shape must be {"artifacts":[{"filename":"name.py","mimeType":"text/x-python","content":"complete source"}]}.',
  'Phase 1 supports Python code artifacts only: use a safe basename ending in .py and MIME text/x-python.',
].join(' ');

const FILE_ARTIFACT_INSTRUCTION = [
  'This is a file artifact request. Generate file content only; do not claim tool execution or file delivery.',
  'Return exactly one JSON object and no Markdown fences or surrounding prose.',
  'The JSON shape must be {"artifacts":[{"filename":"safe-name.ext","mimeType":"allowed/type","content":"complete content"}]}.',
  'Allowed pairs are .md=text/markdown, .txt=text/plain, .json=application/json, .yaml/.yml=application/yaml, and .csv=text/csv.',
  'Use only a basename, never a directory or path.',
].join(' ');

export class AiArtifactRuntime {
  private readonly generationService: AiRuntimeGenerationService;
  private readonly artifactConfig: AiArtifactConfig;
  private readonly telemetry: AiArtifactTelemetrySink | undefined;

  constructor(options: AiArtifactRuntimeOptions) {
    this.generationService = options.generationService;
    this.artifactConfig = options.artifactConfig;
    this.telemetry = options.telemetry;
  }

  async prepare(request: AiArtifactRuntimeRequest): Promise<AiArtifactRuntimeResult> {
    const intent = resolveAiArtifactIntent(request.input);
    if (intent === 'chat' || intent === 'detailed_answer') {
      this.emitTelemetry({
        intent,
        resultCategory: 'not_handled',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
      });
      return { status: 'not_handled', intent };
    }

    if (intent === 'code_execution') {
      this.emitTelemetry({
        intent,
        resultCategory: 'rejected',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
      });
      return {
        status: 'unsupported',
        intent,
        userMessage: 'Python実行はまだ有効化されていません。コードは実行していません。',
      };
    }

    if (intent === 'image_generation') {
      this.emitTelemetry({
        intent,
        resultCategory: 'rejected',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
      });
      return {
        status: 'unsupported',
        intent,
        userMessage: '画像生成はまだ有効化されていません。画像は生成していません。',
      };
    }

    if (intent === 'code_artifact' && !isPythonCodeArtifactRequest(request.input)) {
      this.emitTelemetry({
        intent,
        resultCategory: 'rejected',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
      });
      return {
        status: 'unsupported',
        intent,
        userMessage: 'Phase 1ではPythonコードのみ対応しています。成果物は作成していません。',
      };
    }

    try {
      const response = await this.generationService.generate({
        feature: 'ai.artifact',
        input: request.input,
        guildId: request.guildId,
        scopeGuildId: request.scopeGuildId,
        userId: request.userId,
        authorized: request.authorized,
        pluginEnabled: request.pluginEnabled,
        guildOptIn: request.guildOptIn,
        responseMode: 'artifact',
        groundingState: 'not_required',
        trustedInstructions: [
          intent === 'code_artifact' ? CODE_ARTIFACT_INSTRUCTION : FILE_ARTIFACT_INSTRUCTION,
        ],
      });

      const drafts = parseGeneratedArtifactEnvelope(response.text, intent);
      const artifacts = validateAiArtifactBatch(drafts, this.artifactConfig);
      assertIntentMatchesArtifacts(intent, artifacts);
      this.emitTelemetry(successTelemetry(intent, artifacts));
      return { status: 'ready', intent, artifacts };
    } catch (error) {
      if (error instanceof AiFoundationError) {
        this.emitTelemetry({
          intent,
          resultCategory: 'failed',
          artifactCount: 0,
          totalBytes: 0,
          artifacts: [],
          errorCategory: 'foundation_error',
        });
        throw error;
      }
      const safeError =
        error instanceof AiArtifactRuntimeError
          ? error
          : new AiArtifactRuntimeError(
              isArtifactValidationError(error) ? 'validation_failed' : 'internal_error',
            );
      this.emitTelemetry({
        intent,
        resultCategory: 'failed',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: safeError.category,
      });
      throw safeError;
    }
  }

  private emitTelemetry(event: AiArtifactTelemetryEvent): void {
    if (!this.telemetry) return;
    try {
      const pending = this.telemetry(event);
      void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Artifact telemetry is safe metadata only and must never change delivery behavior.
    }
  }
}

function parseGeneratedArtifactEnvelope(
  text: string,
  intent: 'code_artifact' | 'file_artifact',
): AiArtifactDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim()) as unknown;
  } catch {
    throw new AiArtifactRuntimeError('malformed_generation');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['artifacts'])) {
    throw new AiArtifactRuntimeError('malformed_generation');
  }

  return parsed['artifacts'].map((candidate) => {
    if (!isRecord(candidate)) throw new AiArtifactRuntimeError('malformed_generation');
    const filename = candidate['filename'];
    const mimeType = candidate['mimeType'];
    const content = candidate['content'];
    if (
      typeof filename !== 'string' ||
      typeof mimeType !== 'string' ||
      typeof content !== 'string'
    ) {
      throw new AiArtifactRuntimeError('malformed_generation');
    }
    return {
      filename,
      mimeType,
      content,
      kind: intent === 'code_artifact' ? 'code' : artifactKindForFilename(filename),
    };
  });
}

function artifactKindForFilename(filename: string): AiArtifact['kind'] {
  const lower = filename.toLowerCase();
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

function assertIntentMatchesArtifacts(
  intent: 'code_artifact' | 'file_artifact',
  artifacts: readonly AiArtifact[],
): void {
  if (intent === 'code_artifact') {
    if (
      artifacts.length !== 1 ||
      artifacts[0]?.kind !== 'code' ||
      !artifacts[0].filename.toLowerCase().endsWith('.py') ||
      artifacts[0].mimeType !== 'text/x-python'
    ) {
      throw new AiArtifactRuntimeError('validation_failed');
    }
    return;
  }
  if (artifacts.some((artifact) => artifact.kind === 'code' || artifact.kind === 'image')) {
    throw new AiArtifactRuntimeError('validation_failed');
  }
}

function successTelemetry(
  intent: 'code_artifact' | 'file_artifact',
  artifacts: readonly AiArtifact[],
): AiArtifactTelemetryEvent {
  return {
    intent,
    resultCategory: 'success',
    artifactCount: artifacts.length,
    totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.size, 0),
    artifacts: artifacts.map((artifact) => ({
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      size: artifact.size,
    })),
    errorCategory: null,
  };
}

function isArtifactValidationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AiArtifactValidationError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
