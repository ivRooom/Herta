import { createHash, randomUUID } from 'node:crypto';
import type { AiArtifactConfig, AiArtifactKind } from '@herta/plugin-catalog/ai-artifact';
import {
  AI_OPENAI_MODELS,
  AiFoundationError,
  estimateInputTokens,
  estimateOpenAiCostMicroUsd,
  type AiFoundationConfig,
  type AiGuardStore,
  type AiOpenAiModel,
  type AiTelemetrySink,
  type AiUsage,
} from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { AI_IMAGE_ARTIFACT_DEFAULTS } from './image-artifact-validation.js';
import {
  isAiExecutionImageArtifactPolicy,
  resolveAiExecutionArtifactDownloadPolicy,
  type AiExecutionArtifactDownloadPolicy,
} from './execution-artifact-validation.js';
import { OpenAiRuntimeGenerationService } from './runtime-service.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const OPENAI_CODE_INTERPRETER_MEMORY_LIMIT = '1g';
const OPENAI_CODE_INTERPRETER_SESSION_MICRO_USD = 30_000;
const OPENAI_CODE_INTERPRETER_PRICING_VERIFIED_AT = '2026-08-27';
const OPENAI_CODE_INTERPRETER_PRICING_REVIEW_AFTER_MS = Date.parse('2026-09-27T00:00:00.000Z');
const OPENAI_CODE_INTERPRETER_MAX_TOOL_CALLS = 8;
const EXECUTION_SUMMARY_MAX_CHARS = 600;
const CONTROL_RESPONSE_MAX_BYTES = 64 * 1024;
const CLEANUP_TIMEOUT_MS = 3_000;

export type AiCodeExecutionErrorCategory =
  | 'sandbox_policy_failed'
  | 'tool_not_invoked'
  | 'malformed_output'
  | 'output_limit_exceeded'
  | 'artifact_download_failed'
  | 'cleanup_failed';

export class AiCodeExecutionError extends Error {
  readonly category: AiCodeExecutionErrorCategory;
  readonly userMessage = 'Python実行を安全に完了できませんでした。';

  constructor(category: AiCodeExecutionErrorCategory) {
    super(`AI code execution failed: ${category}`);
    this.name = 'AiCodeExecutionError';
    this.category = category;
  }
}

export interface AiCodeExecutionFile {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  kind: AiArtifactKind;
}

export interface AiCodeExecutionRequest {
  input: string;
  guildId: string;
  scopeGuildId: string;
  userId: string;
  authorized: boolean;
  pluginEnabled: boolean;
  guildOptIn: boolean;
  artifactConfig: AiArtifactConfig;
}

export interface AiCodeExecutionResult {
  requestId: string;
  provider: 'openai';
  model: AiOpenAiModel;
  usage: AiUsage;
  estimatedCost: number;
  durationMs: number;
  summary: string;
  files: AiCodeExecutionFile[];
  sandboxDestroyed: true;
  pricingVerifiedAt: string;
}

export interface AiCodeExecutionService {
  execute(request: AiCodeExecutionRequest): Promise<AiCodeExecutionResult>;
}

export interface OpenAiCodeExecutionServiceOptions {
  baseConfig: AiFoundationConfig;
  apiKey: string;
  guardStore: AiGuardStore;
  runtimeResolver: AiRuntimeConfigurationResolver;
  telemetry?: AiTelemetrySink;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CapturedExecution {
  files: AiCodeExecutionFile[];
  sandboxDestroyed: boolean;
  error: AiCodeExecutionError | null;
}

interface SandboxDescriptor {
  id: string;
  policyConfirmed: boolean;
}

interface ContainerFileCitation {
  containerId: string;
  fileId: string;
  filename: string;
}

const EXECUTION_INSTRUCTION = [
  'This is an explicit Python execution request.',
  'You must use the provided Code Interpreter tool; never claim execution unless the tool actually ran.',
  'Use Python only inside the isolated Code Interpreter container.',
  'Do not reproduce the full source code, raw stdout, raw stderr, environment values, credentials, or secrets in the assistant text.',
  'Return only a concise execution summary. If files are created, cite the actual generated container files so the application can retrieve them.',
  'Do not use network access. Do not claim a file was created unless it exists in the container output.',
].join(' ');

export class OpenAiCodeExecutionService implements AiCodeExecutionService {
  private readonly baseConfig: AiFoundationConfig;
  private readonly apiKey: string;
  private readonly guardStore: AiGuardStore;
  private readonly runtimeResolver: AiRuntimeConfigurationResolver;
  private readonly telemetry: AiTelemetrySink | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: OpenAiCodeExecutionServiceOptions) {
    this.baseConfig = options.baseConfig;
    this.apiKey = options.apiKey;
    this.guardStore = options.guardStore;
    this.runtimeResolver = options.runtimeResolver;
    this.telemetry = options.telemetry;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async execute(request: AiCodeExecutionRequest): Promise<AiCodeExecutionResult> {
    const startedAt = this.now();
    assertContainerPricingCurrent(startedAt);
    const captured: CapturedExecution = { files: [], sandboxDestroyed: false, error: null };
    const generationService = new OpenAiRuntimeGenerationService({
      baseConfig: this.baseConfig,
      apiKey: this.apiKey,
      guardStore: this.guardStore,
      runtimeResolver: this.runtimeResolver,
      telemetry: this.telemetry,
      fetchImpl: (input, init) => this.executeResponsesRequest(input, init, request, captured),
    });

    const response = await generationService
      .generate({
        feature: 'ai.code_execution',
        input: request.input,
        guildId: request.guildId,
        scopeGuildId: request.scopeGuildId,
        userId: request.userId,
        authorized: request.authorized,
        pluginEnabled: request.pluginEnabled,
        guildOptIn: request.guildOptIn,
        responseMode: 'artifact',
        groundingState: 'not_required',
        trustedInstructions: [EXECUTION_INSTRUCTION],
      })
      .catch((error: unknown) => {
        if (captured.error) throw captured.error;
        throw error;
      });

    if (!captured.sandboxDestroyed) throw new AiCodeExecutionError('cleanup_failed');
    return {
      requestId: response.requestId,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      estimatedCost:
        response.estimatedCost + microUsdToUsd(OPENAI_CODE_INTERPRETER_SESSION_MICRO_USD),
      durationMs: Math.max(0, this.now() - startedAt),
      summary: boundedSummary(response.text),
      files: captured.files,
      sandboxDestroyed: true,
      pricingVerifiedAt: OPENAI_CODE_INTERPRETER_PRICING_VERIFIED_AT,
    };
  }

  private async executeResponsesRequest(
    input: Parameters<typeof fetch>[0],
    init: RequestInit | undefined,
    request: AiCodeExecutionRequest,
    captured: CapturedExecution,
  ): Promise<Response> {
    if (typeof init?.body !== 'string') throw new AiFoundationError('internal_error');
    const originalBody = parseJsonRecord(init.body);
    assertCombinedExecutionCostWithinLimit(originalBody, this.baseConfig);

    const toolReservationId = `execution-tool:${randomUUID()}`;
    const guildKey = privacyGuildKey(request.guildId);
    const quota = await this.guardStore.reserveGuildQuota(
      guildKey,
      toolReservationId,
      OPENAI_CODE_INTERPRETER_SESSION_MICRO_USD,
      this.baseConfig.guildQuotaMicroUsd,
      this.baseConfig.quotaWindowMs,
    );
    if (!quota.allowed) {
      throw new AiFoundationError('quota_exceeded', { retryAfterMs: quota.retryAfterMs });
    }

    let containerId: string | null = null;
    let responseResult: Response | null = null;
    let failure: unknown = null;

    try {
      const sandbox = await this.createSandbox(init.signal);
      containerId = sandbox.id;

      // Container creation is the billable tool event. Settle the fixed reservation as soon as
      // creation is confirmed, even if a subsequent policy check or execution step fails.
      await this.guardStore.settleGuildQuota(
        guildKey,
        toolReservationId,
        OPENAI_CODE_INTERPRETER_SESSION_MICRO_USD,
      );
      if (!sandbox.policyConfirmed) throw new AiCodeExecutionError('sandbox_policy_failed');

      const response = await this.fetchImpl(input, {
        ...init,
        headers: openAiHeaders(this.apiKey),
        body: JSON.stringify({
          ...originalBody,
          tools: [{ type: 'code_interpreter', container: containerId }],
          tool_choice: 'required',
          max_tool_calls: OPENAI_CODE_INTERPRETER_MAX_TOOL_CALLS,
          parallel_tool_calls: false,
          include: undefined,
        }),
      });
      const responseBytes = await readBoundedBytes(
        response,
        this.baseConfig.providerResponseMaxBytes,
      );

      if (response.ok) {
        const payload = parseJsonBytes(responseBytes);
        if (isCompletedResponse(payload)) {
          assertCodeInterpreterInvoked(payload);
          const citations = extractContainerFileCitations(payload, containerId);
          if (citations.length > request.artifactConfig.maxFiles) {
            throw new AiCodeExecutionError('output_limit_exceeded');
          }

          let policies: AiExecutionArtifactDownloadPolicy[];
          try {
            policies = citations.map((citation) =>
              resolveAiExecutionArtifactDownloadPolicy(citation.filename, request.artifactConfig),
            );
          } catch {
            throw new AiCodeExecutionError('artifact_download_failed');
          }
          if (
            policies.filter(isAiExecutionImageArtifactPolicy).length >
            AI_IMAGE_ARTIFACT_DEFAULTS.maxFiles
          ) {
            throw new AiCodeExecutionError('output_limit_exceeded');
          }

          captured.files = await Promise.all(
            citations.map((citation, index) => {
              const policy = policies[index];
              if (!policy) throw new AiCodeExecutionError('malformed_output');
              return this.downloadContainerFile(citation, policy, init.signal);
            }),
          );
        }
      }
      responseResult = rebuildResponse(response, responseBytes);
    } catch (error) {
      failure = error;
    }

    if (containerId) {
      try {
        await this.destroySandbox(containerId);
        captured.sandboxDestroyed = true;
      } catch (error) {
        if (!failure) failure = error;
      }
    }

    if (failure) {
      if (failure instanceof AiCodeExecutionError) {
        captured.error = failure;
        throw new AiFoundationError('internal_error');
      }
      throw failure;
    }
    if (!responseResult) {
      captured.error = new AiCodeExecutionError('malformed_output');
      throw new AiFoundationError('internal_error');
    }
    return responseResult;
  }

  private async createSandbox(signal: AbortSignal | null | undefined): Promise<SandboxDescriptor> {
    const response = await this.fetchImpl(`${OPENAI_API_BASE}/containers`, {
      method: 'POST',
      headers: openAiHeaders(this.apiKey),
      body: JSON.stringify({
        name: 'herta-python-execution',
        memory_limit: OPENAI_CODE_INTERPRETER_MEMORY_LIMIT,
        network_policy: { type: 'disabled' },
      }),
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw providerHttpError(response.status);
    }

    const payload = await readBoundedJson(response, CONTROL_RESPONSE_MAX_BYTES);
    if (!isRecord(payload)) throw new AiCodeExecutionError('sandbox_policy_failed');
    const id = safeProviderId(payload['id']);
    if (!id) throw new AiCodeExecutionError('sandbox_policy_failed');
    const networkPolicy = payload['network_policy'];
    return {
      id,
      policyConfirmed:
        payload['memory_limit'] === OPENAI_CODE_INTERPRETER_MEMORY_LIMIT &&
        isRecord(networkPolicy) &&
        networkPolicy['type'] === 'disabled',
    };
  }

  private async destroySandbox(containerId: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(
        `${OPENAI_API_BASE}/containers/${encodeURIComponent(containerId)}`,
        {
          method: 'DELETE',
          headers: openAiHeaders(this.apiKey),
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new AiCodeExecutionError('cleanup_failed');
    } catch (error) {
      if (error instanceof AiCodeExecutionError) throw error;
      throw new AiCodeExecutionError('cleanup_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private async downloadContainerFile(
    citation: ContainerFileCitation,
    policy: AiExecutionArtifactDownloadPolicy,
    signal: AbortSignal | null | undefined,
  ): Promise<AiCodeExecutionFile> {
    const response = await this.fetchImpl(
      `${OPENAI_API_BASE}/containers/${encodeURIComponent(citation.containerId)}/files/${encodeURIComponent(citation.fileId)}/content`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/octet-stream',
        },
        cache: 'no-store',
        signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiCodeExecutionError('artifact_download_failed');
    }

    const declaredMime = normalizeContentType(response.headers.get('content-type'));
    if (
      declaredMime &&
      declaredMime !== 'application/octet-stream' &&
      declaredMime !== policy.mimeType
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiCodeExecutionError('artifact_download_failed');
    }

    const bytes = await readBoundedBytes(response, policy.maxBytes);
    if (policy.requiresUtf8) assertUtf8Text(bytes);
    return {
      filename: policy.filename,
      mimeType: policy.mimeType,
      bytes,
      kind: policy.kind,
    };
  }
}

function assertCombinedExecutionCostWithinLimit(
  body: Record<string, unknown>,
  config: AiFoundationConfig,
): void {
  const model = body['model'];
  const input = body['input'];
  const instructions = body['instructions'];
  const maxOutputTokens = body['max_output_tokens'];
  if (
    typeof model !== 'string' ||
    !(AI_OPENAI_MODELS as readonly string[]).includes(model) ||
    typeof input !== 'string' ||
    typeof instructions !== 'string' ||
    typeof maxOutputTokens !== 'number' ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  ) {
    throw new AiFoundationError('internal_error');
  }

  const tokenReservation = estimateOpenAiCostMicroUsd(
    model as AiOpenAiModel,
    estimateInputTokens(`${instructions}\n${input}`),
    maxOutputTokens,
  );
  if (
    tokenReservation + OPENAI_CODE_INTERPRETER_SESSION_MICRO_USD >
    config.perRequestCostLimitMicroUsd
  ) {
    throw new AiFoundationError('quota_exceeded');
  }
}

function assertContainerPricingCurrent(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs >= OPENAI_CODE_INTERPRETER_PRICING_REVIEW_AFTER_MS) {
    throw new AiFoundationError('disabled');
  }
}

function extractContainerFileCitations(
  payload: Record<string, unknown>,
  expectedContainerId: string,
): ContainerFileCitation[] {
  const output = payload['output'];
  if (!Array.isArray(output)) throw new AiCodeExecutionError('malformed_output');

  const citations = new Map<string, ContainerFileCitation>();
  for (const item of output) {
    if (!isRecord(item) || item['type'] !== 'message') continue;
    const content = item['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part) || part['type'] !== 'output_text') continue;
      const annotations = part['annotations'];
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!isRecord(annotation) || annotation['type'] !== 'container_file_citation') continue;
        const containerId = safeProviderId(annotation['container_id']);
        const fileId = safeProviderId(annotation['file_id']);
        const filename = annotation['filename'];
        if (
          !containerId ||
          containerId !== expectedContainerId ||
          !fileId ||
          typeof filename !== 'string'
        ) {
          throw new AiCodeExecutionError('malformed_output');
        }
        citations.set(`${containerId}:${fileId}`, { containerId, fileId, filename });
      }
    }
  }
  return [...citations.values()];
}

function assertCodeInterpreterInvoked(payload: Record<string, unknown>): void {
  const output = payload['output'];
  if (!Array.isArray(output)) throw new AiCodeExecutionError('malformed_output');
  let invoked = false;
  for (const item of output) {
    if (!isRecord(item) || item['type'] !== 'code_interpreter_call') continue;
    invoked = true;
    if (typeof item['status'] === 'string' && item['status'] !== 'completed') {
      throw new AiCodeExecutionError('malformed_output');
    }
  }
  if (!invoked) throw new AiCodeExecutionError('tool_not_invoked');
}

function isCompletedResponse(payload: Record<string, unknown>): boolean {
  return payload['status'] === 'completed';
}

function boundedSummary(value: string): string {
  const normalized = value.replace(/\u0000/g, '').trim();
  if (!normalized) throw new AiCodeExecutionError('malformed_output');
  const chars = Array.from(normalized);
  return chars.length <= EXECUTION_SUMMARY_MAX_CHARS
    ? normalized
    : `${chars.slice(0, EXECUTION_SUMMARY_MAX_CHARS).join('')}…`;
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error('not record');
    return parsed;
  } catch {
    throw new AiFoundationError('internal_error');
  }
}

function parseJsonBytes(bytes: Uint8Array): Record<string, unknown> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isRecord(parsed)) throw new Error('not record');
    return parsed;
  } catch {
    throw new AiCodeExecutionError('malformed_output');
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(await readBoundedBytes(response, maxBytes)),
    ) as unknown;
  } catch (error) {
    if (error instanceof AiCodeExecutionError) throw error;
    throw new AiCodeExecutionError('malformed_output');
  }
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiCodeExecutionError('output_limit_exceeded');
  }
  if (!response.body) throw new AiCodeExecutionError('malformed_output');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiCodeExecutionError('output_limit_exceeded');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertUtf8Text(bytes: Uint8Array): void {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AiCodeExecutionError('artifact_download_failed');
  }
}

function rebuildResponse(response: Response, bytes: Uint8Array): Response {
  return new Response(bytes.slice().buffer, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function normalizeContentType(value: string | null): string | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  return normalized || null;
}

function safeProviderId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
}

function providerHttpError(status: number): AiFoundationError {
  return status === 408 || status === 409 || status === 429 || status >= 500
    ? new AiFoundationError('provider_unavailable')
    : new AiFoundationError('provider_rejected');
}

function privacyGuildKey(guildId: string): string {
  const digest = createHash('sha256').update(guildId).digest('hex').slice(0, 32);
  return `guild:${digest}`;
}

function microUsdToUsd(value: number): number {
  return Math.round(Math.max(0, value)) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
