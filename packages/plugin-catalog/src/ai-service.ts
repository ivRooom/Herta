import { createHash, randomUUID } from 'node:crypto';

export const AI_SUPPORTED_PROVIDERS = ['openai'] as const;
export const AI_MODEL_PROFILES = ['quality', 'balanced', 'economy'] as const;
export const AI_OPENAI_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;

export type AiProviderName = (typeof AI_SUPPORTED_PROVIDERS)[number];
export type AiModelProfile = (typeof AI_MODEL_PROFILES)[number];
export type AiOpenAiModel = (typeof AI_OPENAI_MODELS)[number];

export type AiFailureCategory =
  | 'disabled'
  | 'unauthorized'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'invalid_input'
  | 'timeout'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'malformed_response'
  | 'output_too_large'
  | 'internal_error';

export type AiResultCategory = 'success' | 'rejected' | 'failed';

const MODEL_BY_PROFILE: Record<AiModelProfile, AiOpenAiModel> = {
  quality: 'gpt-5.6-sol',
  balanced: 'gpt-5.6-terra',
  economy: 'gpt-5.6-luna',
};

/**
 * OpenAI standard short-context pricing (USD / 1M tokens) captured for deterministic cost guards.
 * This is intentionally code-reviewed rather than fetched at runtime. When prices change,
 * update these values and docs in the same PR.
 */
const OPENAI_STANDARD_PRICING: Record<
  AiOpenAiModel,
  { inputUsdPerMillion: number; outputUsdPerMillion: number }
> = {
  'gpt-5.6-sol': { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  'gpt-5.6-terra': { inputUsdPerMillion: 2, outputUsdPerMillion: 12 },
  'gpt-5.6-luna': { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
};

/** OpenAI guarantees the current Sol promotional price at least through 2026-11-21. */
const OPENAI_SOL_PROMOTIONAL_PRICING_REVIEW_AFTER_MS = Date.parse('2026-11-22T00:00:00.000Z');

export const AI_DEFAULTS = {
  enabled: false,
  killSwitch: false,
  provider: 'openai' as AiProviderName,
  modelProfile: 'balanced' as AiModelProfile,
  maxInputChars: 8_000,
  maxInputBytes: 24_000,
  maxOutputTokens: 800,
  maxOutputChars: 6_000,
  timeoutMs: 30_000,
  providerResponseMaxBytes: 512 * 1024,
  userRateLimit: 6,
  guildRateLimit: 30,
  rateWindowMs: 60_000,
  guildQuotaMicroUsd: 1_000_000,
  quotaWindowMs: 24 * 60 * 60 * 1_000,
  globalConcurrency: 4,
  perRequestCostLimitMicroUsd: 120_000,
} as const;

export interface AiFoundationConfig {
  enabled: boolean;
  killSwitch: boolean;
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  model: AiOpenAiModel;
  maxInputChars: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  maxOutputChars: number;
  timeoutMs: number;
  providerResponseMaxBytes: number;
  userRateLimit: number;
  guildRateLimit: number;
  rateWindowMs: number;
  guildQuotaMicroUsd: number;
  quotaWindowMs: number;
  globalConcurrency: number;
  perRequestCostLimitMicroUsd: number;
}

export type AiConfigurationErrorCode = 'invalid_provider' | 'invalid_model' | 'invalid_value';

export class AiConfigurationError extends Error {
  readonly code: AiConfigurationErrorCode;

  constructor(code: AiConfigurationErrorCode, field: string) {
    super(`AI configuration is invalid: ${field}`);
    this.name = 'AiConfigurationError';
    this.code = code;
  }
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiProviderResult {
  text: string;
  usage: AiUsage;
}

export interface AiProviderRequest {
  requestId: string;
  model: AiOpenAiModel;
  input: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface AiGenerationProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

export interface AiRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface AiQuotaReservationResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Production implementation must be shared across replicas. RedisAiGuardStore is the
 * production adapter; tests may inject deterministic in-memory fakes.
 */
export interface AiGuardStore {
  consumeRateLimit(key: string, limit: number, windowMs: number): Promise<AiRateLimitResult>;
  reserveGuildQuota(
    guildKey: string,
    requestId: string,
    amountMicroUsd: number,
    limitMicroUsd: number,
    windowMs: number,
  ): Promise<AiQuotaReservationResult>;
  settleGuildQuota(guildKey: string, requestId: string, actualMicroUsd: number): Promise<number>;
  acquireConcurrency(requestId: string, limit: number, leaseMs: number): Promise<boolean>;
  releaseConcurrency(requestId: string): Promise<void>;
}

export interface AiGenerationRequest {
  feature: string;
  input: string;
  guildId: string;
  /** Guild-bound runtime scope. A mismatch is rejected before any provider call. */
  scopeGuildId: string;
  userId: string;
  authorized: boolean;
  pluginEnabled: boolean;
  guildOptIn: boolean;
}

export interface AiGenerationResponse {
  requestId: string;
  provider: AiProviderName;
  model: AiOpenAiModel;
  text: string;
  usage: AiUsage;
  estimatedCost: number;
}

export interface AiTelemetryEvent {
  requestId: string;
  feature: string;
  provider: AiProviderName;
  model: AiOpenAiModel;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  resultCategory: AiResultCategory;
  errorCategory: AiFailureCategory | null;
}

export type AiTelemetrySink = (event: AiTelemetryEvent) => void | Promise<void>;

const USER_MESSAGES: Record<AiFailureCategory, string> = {
  disabled: 'AI機能は現在利用できません。',
  unauthorized: 'このAI機能を利用する権限がありません。',
  rate_limited: 'AI機能の利用が集中しています。時間をおいて再度お試しください。',
  quota_exceeded: 'このサーバーのAI利用上限に達しました。',
  invalid_input: '入力内容を確認してください。',
  timeout: 'AIの応答がタイムアウトしました。',
  provider_unavailable: 'AIサービスへ一時的に接続できません。',
  provider_rejected: 'AIサービスがリクエストを受け付けませんでした。',
  malformed_response: 'AIサービスから正常な応答を取得できませんでした。',
  output_too_large: 'AIの応答が許容サイズを超えました。',
  internal_error: 'AI機能の処理中にエラーが発生しました。',
};

export class AiFoundationError extends Error {
  readonly category: AiFailureCategory;
  readonly userMessage: string;
  readonly retryAfterMs: number | undefined;

  constructor(category: AiFailureCategory, options: { retryAfterMs?: number } = {}) {
    super(`AI request failed: ${category}`);
    this.name = 'AiFoundationError';
    this.category = category;
    this.userMessage = USER_MESSAGES[category];
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function toSafeAiFoundationError(error: unknown): AiFoundationError {
  return error instanceof AiFoundationError ? error : new AiFoundationError('internal_error');
}

export function resolveAiFoundationConfig(
  env: Record<string, string | undefined> = process.env,
): AiFoundationConfig {
  const providerValue = (env['HERTA_AI_PROVIDER']?.trim().toLowerCase() ||
    AI_DEFAULTS.provider) as string;
  if (!isAiProvider(providerValue))
    throw new AiConfigurationError('invalid_provider', 'HERTA_AI_PROVIDER');

  const profileValue = (env['HERTA_AI_MODEL_PROFILE']?.trim().toLowerCase() ||
    AI_DEFAULTS.modelProfile) as string;
  if (!isAiModelProfile(profileValue)) {
    throw new AiConfigurationError('invalid_model', 'HERTA_AI_MODEL_PROFILE');
  }

  const configuredModel = env['HERTA_AI_MODEL']?.trim();
  const modelValue = configuredModel || MODEL_BY_PROFILE[profileValue];
  if (!isAiOpenAiModel(modelValue))
    throw new AiConfigurationError('invalid_model', 'HERTA_AI_MODEL');

  return {
    enabled: envFlag(env['HERTA_AI_ENABLED'], AI_DEFAULTS.enabled),
    killSwitch: envFlag(env['HERTA_AI_KILL_SWITCH'], AI_DEFAULTS.killSwitch),
    provider: providerValue,
    modelProfile: profileValue,
    model: modelValue,
    maxInputChars: boundedInteger(
      env,
      'HERTA_AI_MAX_INPUT_CHARS',
      AI_DEFAULTS.maxInputChars,
      1,
      16_000,
    ),
    maxInputBytes: boundedInteger(
      env,
      'HERTA_AI_MAX_INPUT_BYTES',
      AI_DEFAULTS.maxInputBytes,
      1,
      64_000,
    ),
    maxOutputTokens: boundedInteger(
      env,
      'HERTA_AI_MAX_OUTPUT_TOKENS',
      AI_DEFAULTS.maxOutputTokens,
      1,
      2_048,
    ),
    maxOutputChars: boundedInteger(
      env,
      'HERTA_AI_MAX_OUTPUT_CHARS',
      AI_DEFAULTS.maxOutputChars,
      1,
      12_000,
    ),
    timeoutMs: boundedInteger(env, 'HERTA_AI_TIMEOUT_MS', AI_DEFAULTS.timeoutMs, 1_000, 30_000),
    providerResponseMaxBytes: boundedInteger(
      env,
      'HERTA_AI_PROVIDER_RESPONSE_MAX_BYTES',
      AI_DEFAULTS.providerResponseMaxBytes,
      16 * 1024,
      2 * 1024 * 1024,
    ),
    userRateLimit: boundedInteger(
      env,
      'HERTA_AI_USER_RATE_LIMIT',
      AI_DEFAULTS.userRateLimit,
      1,
      120,
    ),
    guildRateLimit: boundedInteger(
      env,
      'HERTA_AI_GUILD_RATE_LIMIT',
      AI_DEFAULTS.guildRateLimit,
      1,
      600,
    ),
    rateWindowMs: boundedInteger(
      env,
      'HERTA_AI_RATE_WINDOW_MS',
      AI_DEFAULTS.rateWindowMs,
      1_000,
      60 * 60 * 1_000,
    ),
    guildQuotaMicroUsd: boundedInteger(
      env,
      'HERTA_AI_GUILD_QUOTA_MICRO_USD',
      AI_DEFAULTS.guildQuotaMicroUsd,
      1_000,
      100_000_000,
    ),
    quotaWindowMs: boundedInteger(
      env,
      'HERTA_AI_QUOTA_WINDOW_MS',
      AI_DEFAULTS.quotaWindowMs,
      60_000,
      31 * 24 * 60 * 60 * 1_000,
    ),
    globalConcurrency: boundedInteger(
      env,
      'HERTA_AI_GLOBAL_CONCURRENCY',
      AI_DEFAULTS.globalConcurrency,
      1,
      64,
    ),
    perRequestCostLimitMicroUsd: boundedInteger(
      env,
      'HERTA_AI_PER_REQUEST_COST_LIMIT_MICRO_USD',
      AI_DEFAULTS.perRequestCostLimitMicroUsd,
      100,
      10_000_000,
    ),
  };
}

export interface AiFoundationServiceOptions {
  config: AiFoundationConfig;
  provider: AiGenerationProvider;
  guardStore: AiGuardStore;
  telemetry?: AiTelemetrySink;
  now?: () => number;
  requestId?: () => string;
}

export class AiFoundationService {
  private readonly config: AiFoundationConfig;
  private readonly provider: AiGenerationProvider;
  private readonly guardStore: AiGuardStore;
  private readonly telemetry: AiTelemetrySink | undefined;
  private readonly now: () => number;
  private readonly requestId: () => string;

  constructor(options: AiFoundationServiceOptions) {
    this.config = options.config;
    this.provider = options.provider;
    this.guardStore = options.guardStore;
    this.telemetry = options.telemetry;
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? randomUUID;
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    const requestId = this.requestId();
    const startedAt = this.now();
    let usage: AiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let estimatedCostMicroUsd = 0;
    let resultCategory: AiResultCategory = 'failed';
    let errorCategory: AiFailureCategory | null = null;
    let quotaReserved = false;
    let concurrencyAcquired = false;
    const feature = normalizeFeature(request.feature);

    try {
      if (!this.config.enabled || this.config.killSwitch) throw new AiFoundationError('disabled');
      if (!request.authorized || request.scopeGuildId !== request.guildId) {
        throw new AiFoundationError('unauthorized');
      }
      if (!request.pluginEnabled || !request.guildOptIn) throw new AiFoundationError('disabled');
      assertOpenAiPricingGuardCurrent(this.config.model, startedAt);

      const input = validateAndNormalizeInput(request.input, this.config);
      const userKey = privacyKey('user', request.guildId, request.userId);
      const guildKey = privacyKey('guild', request.guildId);

      const userRate = await this.guardStore.consumeRateLimit(
        userKey,
        this.config.userRateLimit,
        this.config.rateWindowMs,
      );
      if (!userRate.allowed) {
        throw new AiFoundationError('rate_limited', { retryAfterMs: userRate.retryAfterMs });
      }

      const guildRate = await this.guardStore.consumeRateLimit(
        guildKey,
        this.config.guildRateLimit,
        this.config.rateWindowMs,
      );
      if (!guildRate.allowed) {
        throw new AiFoundationError('rate_limited', { retryAfterMs: guildRate.retryAfterMs });
      }

      const estimatedInputTokens = estimateInputTokens(input);
      const reservationMicroUsd = estimateOpenAiCostMicroUsd(
        this.config.model,
        estimatedInputTokens,
        this.config.maxOutputTokens,
      );
      if (reservationMicroUsd > this.config.perRequestCostLimitMicroUsd) {
        throw new AiFoundationError('quota_exceeded');
      }

      const quota = await this.guardStore.reserveGuildQuota(
        guildKey,
        requestId,
        reservationMicroUsd,
        this.config.guildQuotaMicroUsd,
        this.config.quotaWindowMs,
      );
      if (!quota.allowed) {
        throw new AiFoundationError('quota_exceeded', { retryAfterMs: quota.retryAfterMs });
      }
      quotaReserved = true;

      concurrencyAcquired = await this.guardStore.acquireConcurrency(
        requestId,
        this.config.globalConcurrency,
        this.config.timeoutMs + 5_000,
      );
      if (!concurrencyAcquired) {
        await this.guardStore.settleGuildQuota(guildKey, requestId, 0);
        quotaReserved = false;
        throw new AiFoundationError('rate_limited', { retryAfterMs: 1_000 });
      }

      const providerResult = await this.provider.generate({
        requestId,
        model: this.config.model,
        input,
        maxOutputTokens: this.config.maxOutputTokens,
        timeoutMs: this.config.timeoutMs,
        maxResponseBytes: this.config.providerResponseMaxBytes,
      });
      usage = providerResult.usage;
      estimatedCostMicroUsd = estimateOpenAiCostMicroUsd(
        this.config.model,
        usage.inputTokens,
        usage.outputTokens,
      );

      const settledTotal = await this.guardStore.settleGuildQuota(
        guildKey,
        requestId,
        estimatedCostMicroUsd,
      );
      quotaReserved = false;

      if (estimatedCostMicroUsd > this.config.perRequestCostLimitMicroUsd) {
        throw new AiFoundationError('quota_exceeded');
      }
      if (settledTotal > this.config.guildQuotaMicroUsd) {
        throw new AiFoundationError('quota_exceeded');
      }
      if (characterLength(providerResult.text) > this.config.maxOutputChars) {
        throw new AiFoundationError('output_too_large');
      }

      resultCategory = 'success';
      return {
        requestId,
        provider: this.config.provider,
        model: this.config.model,
        text: providerResult.text,
        usage,
        estimatedCost: microUsdToUsd(estimatedCostMicroUsd),
      };
    } catch (error) {
      const safeError = toSafeAiFoundationError(error);
      errorCategory = safeError.category;
      resultCategory = isRejectedCategory(safeError.category) ? 'rejected' : 'failed';
      throw safeError;
    } finally {
      if (concurrencyAcquired) {
        await this.guardStore.releaseConcurrency(requestId).catch(() => undefined);
      }
      // If a provider call failed after reservation, keep the conservative reservation until
      // the quota window expires. This avoids under-counting requests whose billing outcome
      // is unknown after timeout/malformed responses.
      void quotaReserved;
      emitTelemetrySafely(this.telemetry, {
        requestId,
        feature,
        provider: this.config.provider,
        model: this.config.model,
        latencyMs: Math.max(0, this.now() - startedAt),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCost: microUsdToUsd(estimatedCostMicroUsd),
        resultCategory,
        errorCategory,
      });
    }
  }
}

export interface OpenAiResponsesProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export class OpenAiResponsesProvider implements AiGenerationProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(options: OpenAiResponsesProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new AiConfigurationError('invalid_value', 'OPENAI_API_KEY');
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    if (!isAiOpenAiModel(request.model)) throw new AiConfigurationError('invalid_model', 'model');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          input: request.input,
          max_output_tokens: request.maxOutputTokens,
          reasoning: { effort: 'low' },
          store: false,
          truncation: 'disabled',
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          throw new AiFoundationError('provider_unavailable');
        }
        throw new AiFoundationError('provider_rejected');
      }

      const payload = await readBoundedJson(response, request.maxResponseBytes);
      return parseOpenAiResponse(payload);
    } catch (error) {
      if (error instanceof AiFoundationError) throw error;
      if (controller.signal.aborted) throw new AiFoundationError('timeout');
      throw new AiFoundationError('provider_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Preflight billing guards must not underestimate token usage. UTF-8 byte length is used as
 * a deliberately conservative upper bound instead of a compression-ratio heuristic; actual
 * provider usage is still settled from the authoritative response usage after generation.
 */
export function estimateInputTokens(input: string): number {
  return Math.max(1, new TextEncoder().encode(input).byteLength);
}

export function estimateOpenAiCostMicroUsd(
  model: AiOpenAiModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = OPENAI_STANDARD_PRICING[model];
  return Math.max(
    0,
    Math.ceil(
      Math.max(0, inputTokens) * pricing.inputUsdPerMillion +
        Math.max(0, outputTokens) * pricing.outputUsdPerMillion,
    ),
  );
}

function parseOpenAiResponse(value: unknown): AiProviderResult {
  if (!isRecord(value)) throw new AiFoundationError('malformed_response');

  const status = value['status'];
  if (status === 'incomplete') {
    const incompleteDetails = value['incomplete_details'];
    if (
      isRecord(incompleteDetails) &&
      (incompleteDetails['reason'] === 'max_output_tokens' ||
        incompleteDetails['reason'] === 'max_tokens')
    ) {
      throw new AiFoundationError('output_too_large');
    }
    throw new AiFoundationError('provider_rejected');
  }
  if (status !== 'completed') {
    throw new AiFoundationError('provider_rejected');
  }

  const usageValue = value['usage'];
  if (!isRecord(usageValue)) throw new AiFoundationError('malformed_response');
  const inputTokens = safeNonNegativeInteger(usageValue['input_tokens']);
  const outputTokens = safeNonNegativeInteger(usageValue['output_tokens']);
  const totalTokens = safeNonNegativeInteger(usageValue['total_tokens']);
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    throw new AiFoundationError('malformed_response');
  }
  if (totalTokens < inputTokens || totalTokens < outputTokens) {
    throw new AiFoundationError('malformed_response');
  }

  const output = value['output'];
  if (!Array.isArray(output)) throw new AiFoundationError('malformed_response');
  const texts: string[] = [];
  let refused = false;

  for (const item of output) {
    if (!isRecord(item) || item['type'] !== 'message') continue;
    const content = item['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
        texts.push(part['text']);
      }
      if (part['type'] === 'refusal') refused = true;
    }
  }

  const text = texts.join('').trim();
  if (!text) {
    if (refused) throw new AiFoundationError('provider_rejected');
    throw new AiFoundationError('malformed_response');
  }

  return {
    text,
    usage: { inputTokens, outputTokens, totalTokens },
  };
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiFoundationError('malformed_response');
  }
  if (!response.body) throw new AiFoundationError('malformed_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiFoundationError('malformed_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AiFoundationError('malformed_response');
  }
}

function validateAndNormalizeInput(input: string, config: AiFoundationConfig): string {
  if (typeof input !== 'string') throw new AiFoundationError('invalid_input');
  const normalized = input.trim();
  const chars = characterLength(normalized);
  if (chars < 1 || chars > config.maxInputChars) throw new AiFoundationError('invalid_input');
  const bytes = new TextEncoder().encode(normalized).byteLength;
  if (bytes > config.maxInputBytes) throw new AiFoundationError('invalid_input');
  return normalized;
}

function normalizeFeature(feature: string): string {
  const normalized = typeof feature === 'string' ? feature.trim() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(normalized)) return 'unknown';
  return normalized;
}

function privacyKey(kind: 'user' | 'guild', ...values: string[]): string {
  const digest = createHash('sha256').update(values.join('\u0000')).digest('hex').slice(0, 32);
  return `${kind}:${digest}`;
}

function isRejectedCategory(category: AiFailureCategory): boolean {
  return (
    category === 'disabled' ||
    category === 'unauthorized' ||
    category === 'rate_limited' ||
    category === 'quota_exceeded' ||
    category === 'invalid_input'
  );
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function microUsdToUsd(value: number): number {
  return Math.round(Math.max(0, value)) / 1_000_000;
}

function assertOpenAiPricingGuardCurrent(model: AiOpenAiModel, nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new AiFoundationError('internal_error');
  if (model === 'gpt-5.6-sol' && nowMs >= OPENAI_SOL_PROMOTIONAL_PRICING_REVIEW_AFTER_MS) {
    throw new AiFoundationError('disabled');
  }
}

function emitTelemetrySafely(sink: AiTelemetrySink | undefined, event: AiTelemetryEvent): void {
  if (!sink) return;
  setTimeout(() => {
    try {
      const pending = sink(event);
      void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Telemetry must never change the user-facing AI result or expose raw content via fallback logs.
    }
  }, 0);
}

function isAiProvider(value: string): value is AiProviderName {
  return (AI_SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

function isAiModelProfile(value: string): value is AiModelProfile {
  return (AI_MODEL_PROFILES as readonly string[]).includes(value);
}

function isAiOpenAiModel(value: string): value is AiOpenAiModel {
  return (AI_OPENAI_MODELS as readonly string[]).includes(value);
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new AiConfigurationError('invalid_value', 'boolean');
}

function boundedInteger(
  env: Record<string, string | undefined>,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[field]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new AiConfigurationError('invalid_value', field);
  }
  return value;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RedisEvalClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

const QUOTA_RESERVE_SCRIPT = `
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[4])
    ttl = tonumber(ARGV[4])
  end
  local reservationsTtl = redis.call('PTTL', KEYS[2])
  if reservationsTtl < 0 or reservationsTtl > ttl then redis.call('PEXPIRE', KEYS[2], ttl) end
  return {1, current, ttl}
end
local startsNewWindow = redis.call('EXISTS', KEYS[1]) == 0
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
if current + amount > limit then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[4]) end
  return {0, current, ttl}
end
local total = redis.call('INCRBY', KEYS[1], amount)
if startsNewWindow then redis.call('PEXPIRE', KEYS[1], ARGV[4]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  ttl = tonumber(ARGV[4])
end
redis.call('HSET', KEYS[2], ARGV[1], amount)
redis.call('PEXPIRE', KEYS[2], ttl)
return {1, total, ttl}
`;

const QUOTA_SETTLE_SCRIPT = `
local reserved = redis.call('HGET', KEYS[2], ARGV[1])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if not reserved then return current end
local delta = tonumber(ARGV[2]) - tonumber(reserved)
local total = redis.call('INCRBY', KEYS[1], delta)
if total < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL'); total = 0 end
redis.call('HDEL', KEYS[2], ARGV[1])
return total
`;

const CONCURRENCY_ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
redis.call('ZADD', KEYS[1], expires, ARGV[4])
redis.call('PEXPIRE', KEYS[1], math.max(1, expires - now))
return 1
`;

const CONCURRENCY_RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`;

export interface RedisAiGuardStoreOptions {
  redis: RedisEvalClient;
  prefix?: string;
  now?: () => number;
}

/** Shared Redis-backed guard store for multi-instance production deployments. */
export class RedisAiGuardStore implements AiGuardStore {
  private readonly redis: RedisEvalClient;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor(options: RedisAiGuardStoreOptions) {
    this.redis = options.redis;
    this.prefix = options.prefix ?? 'herta:ai';
    this.now = options.now ?? Date.now;
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<AiRateLimitResult> {
    const result = await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `${this.prefix}:rate:${key}`,
      windowMs,
    );
    const [count, ttl] = numericTuple(result, 2);
    return { allowed: count <= limit, retryAfterMs: count <= limit ? 0 : Math.max(1, ttl) };
  }

  async reserveGuildQuota(
    guildKey: string,
    requestId: string,
    amountMicroUsd: number,
    limitMicroUsd: number,
    windowMs: number,
  ): Promise<AiQuotaReservationResult> {
    const base = `${this.prefix}:quota:${guildKey}`;
    const result = await this.redis.eval(
      QUOTA_RESERVE_SCRIPT,
      2,
      `${base}:total`,
      `${base}:reservations`,
      requestId,
      amountMicroUsd,
      limitMicroUsd,
      windowMs,
    );
    const [allowed, _total, ttl] = numericTuple(result, 3);
    return { allowed: allowed === 1, retryAfterMs: allowed === 1 ? 0 : Math.max(1, ttl) };
  }

  async settleGuildQuota(
    guildKey: string,
    requestId: string,
    actualMicroUsd: number,
  ): Promise<number> {
    const base = `${this.prefix}:quota:${guildKey}`;
    const result = await this.redis.eval(
      QUOTA_SETTLE_SCRIPT,
      2,
      `${base}:total`,
      `${base}:reservations`,
      requestId,
      Math.max(0, Math.ceil(actualMicroUsd)),
    );
    return numericScalar(result);
  }

  async acquireConcurrency(requestId: string, limit: number, leaseMs: number): Promise<boolean> {
    const now = this.now();
    const result = await this.redis.eval(
      CONCURRENCY_ACQUIRE_SCRIPT,
      1,
      `${this.prefix}:concurrency`,
      now,
      now + leaseMs,
      limit,
      requestId,
    );
    return numericScalar(result) === 1;
  }

  async releaseConcurrency(requestId: string): Promise<void> {
    await this.redis.eval(CONCURRENCY_RELEASE_SCRIPT, 1, `${this.prefix}:concurrency`, requestId);
  }
}

function numericTuple(value: unknown, length: 2): [number, number];
function numericTuple(value: unknown, length: 3): [number, number, number];
function numericTuple(value: unknown, length: 2 | 3): [number, number] | [number, number, number] {
  if (!Array.isArray(value) || value.length < length) {
    throw new AiFoundationError('internal_error');
  }
  if (length === 2) return [numericScalar(value[0]), numericScalar(value[1])];
  return [numericScalar(value[0]), numericScalar(value[1]), numericScalar(value[2])];
}

function numericScalar(value: unknown): number {
  const numberValue =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(numberValue)) throw new AiFoundationError('internal_error');
  return numberValue;
}
