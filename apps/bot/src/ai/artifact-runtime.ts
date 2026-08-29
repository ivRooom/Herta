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
import {
  AiCodeExecutionError,
  type AiCodeExecutionErrorCategory,
  type AiCodeExecutionService,
} from './code-execution-service.js';
import {
  AiExecutionArtifactValidationError,
  validateAiExecutionArtifactBatch,
} from './execution-artifact-validation.js';
import {
  AiImageGenerationError,
  type AiImageGenerationErrorCategory,
  type AiImageGenerationService,
} from './image-generation-service.js';
import {
  AiImageArtifactValidationError,
  validateAiImageArtifactBatch,
} from './image-artifact-validation.js';
import type { AiRuntimeGenerationService } from './runtime-service.js';

export type AiArtifactRuntimeErrorCategory =
  | 'malformed_generation'
  | 'validation_failed'
  | 'execution_failed'
  | 'image_generation_failed'
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
      intent: 'code_artifact' | 'file_artifact' | 'image_generation';
      artifacts: AiArtifact[];
    }
  | {
      status: 'executed';
      intent: 'code_execution';
      summary: string;
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
  executionStatus?: 'success' | 'failed' | 'not_run';
  executionErrorCategory?: AiCodeExecutionErrorCategory | null;
  imageGenerationStatus?: 'success' | 'failed' | 'not_run';
  imageGenerationErrorCategory?: AiImageGenerationErrorCategory | null;
  durationMs?: number;
  provider?: string;
  model?: string;
}

export type AiArtifactTelemetrySink = (event: AiArtifactTelemetryEvent) => void | Promise<void>;

export interface AiArtifactRuntimeOptions {
  generationService: AiRuntimeGenerationService;
  executionService?: AiCodeExecutionService;
  imageGenerationService?: AiImageGenerationService;
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
  private readonly executionService: AiCodeExecutionService | undefined;
  private readonly imageGenerationService: AiImageGenerationService | undefined;
  private readonly artifactConfig: AiArtifactConfig;
  private readonly telemetry: AiArtifactTelemetrySink | undefined;

  constructor(options: AiArtifactRuntimeOptions) {
    this.generationService = options.generationService;
    this.executionService = options.executionService;
    this.imageGenerationService = options.imageGenerationService;
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
      return this.executeCode(request);
    }

    if (intent === 'image_generation') {
      return this.generateImage(request);
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

  private async generateImage(request: AiArtifactRuntimeRequest): Promise<AiArtifactRuntimeResult> {
    if (!this.imageGenerationService) {
      this.emitTelemetry({
        intent: 'image_generation',
        resultCategory: 'rejected',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
        imageGenerationStatus: 'not_run',
      });
      return {
        status: 'unsupported',
        intent: 'image_generation',
        userMessage: '画像生成は現在利用できません。画像は生成していません。',
      };
    }

    try {
      const result = await this.imageGenerationService.generate(request);
      const artifacts = await validateAiImageArtifactBatch([
        {
          filename: result.file.filename,
          mimeType: result.file.mimeType,
          bytes: result.file.bytes,
        },
      ]);
      this.emitTelemetry({
        ...successTelemetry('image_generation', artifacts),
        imageGenerationStatus: 'success',
        imageGenerationErrorCategory: null,
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model,
      });
      return { status: 'ready', intent: 'image_generation', artifacts };
    } catch (error) {
      if (error instanceof AiFoundationError) {
        this.emitTelemetry({
          intent: 'image_generation',
          resultCategory: 'failed',
          artifactCount: 0,
          totalBytes: 0,
          artifacts: [],
          errorCategory: 'foundation_error',
          imageGenerationStatus: 'failed',
        });
        throw error;
      }
      if (error instanceof AiImageGenerationError) {
        this.emitTelemetry({
          intent: 'image_generation',
          resultCategory: 'failed',
          artifactCount: 0,
          totalBytes: 0,
          artifacts: [],
          errorCategory: 'image_generation_failed',
          imageGenerationStatus: 'failed',
          imageGenerationErrorCategory: error.category,
        });
        throw error;
      }
      const safeError = new AiArtifactRuntimeError(
        error instanceof AiImageArtifactValidationError ? 'validation_failed' : 'internal_error',
      );
      this.emitTelemetry({
        intent: 'image_generation',
        resultCategory: 'failed',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: safeError.category,
        imageGenerationStatus: 'failed',
      });
      throw safeError;
    }
  }

  private async executeCode(request: AiArtifactRuntimeRequest): Promise<AiArtifactRuntimeResult> {
    if (!this.executionService) {
      this.emitTelemetry({
        intent: 'code_execution',
        resultCategory: 'rejected',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: null,
        executionStatus: 'not_run',
      });
      return {
        status: 'unsupported',
        intent: 'code_execution',
        userMessage: 'Python実行は現在利用できません。コードは実行していません。',
      };
    }

    try {
      const result = await this.executionService.execute({
        ...request,
        artifactConfig: this.artifactConfig,
      });
      const artifacts = await validateAiExecutionArtifactBatch(result.files, this.artifactConfig);
      if (!result.sandboxDestroyed) throw new AiCodeExecutionError('cleanup_failed');

      this.emitTelemetry({
        ...successTelemetry('code_execution', artifacts),
        executionStatus: 'success',
        executionErrorCategory: null,
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model,
      });
      return { status: 'executed', intent: 'code_execution', summary: result.summary, artifacts };
    } catch (error) {
      if (error instanceof AiFoundationError) {
        this.emitTelemetry({
          intent: 'code_execution',
          resultCategory: 'failed',
          artifactCount: 0,
          totalBytes: 0,
          artifacts: [],
          errorCategory: 'foundation_error',
          executionStatus: 'failed',
        });
        throw error;
      }
      if (error instanceof AiCodeExecutionError) {
        this.emitTelemetry({
          intent: 'code_execution',
          resultCategory: 'failed',
          artifactCount: 0,
          totalBytes: 0,
          artifacts: [],
          errorCategory: 'execution_failed',
          executionStatus: 'failed',
          executionErrorCategory: error.category,
        });
        throw error;
      }
      const safeError = new AiArtifactRuntimeError(
        isArtifactValidationError(error) ? 'validation_failed' : 'internal_error',
      );
      this.emitTelemetry({
        intent: 'code_execution',
        resultCategory: 'failed',
        artifactCount: 0,
        totalBytes: 0,
        artifacts: [],
        errorCategory: safeError.category,
        executionStatus: 'failed',
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
  if (
    artifacts.some(
      (artifact) =>
        artifact.kind === 'code' ||
        artifact.kind === 'image' ||
        artifact.filename.toLowerCase().endsWith('.py'),
    )
  ) {
    throw new AiArtifactRuntimeError('validation_failed');
  }
}

function successTelemetry(
  intent: 'code_artifact' | 'file_artifact' | 'code_execution' | 'image_generation',
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
  return (
    error instanceof AiExecutionArtifactValidationError ||
    error instanceof AiImageArtifactValidationError ||
    (error instanceof Error && error.name === 'AiArtifactValidationError')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
