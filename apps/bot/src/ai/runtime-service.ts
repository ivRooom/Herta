import { createHash } from 'node:crypto';
import {
  resolveAiConversationPolicy,
  type AiConversationPolicy,
  type AiGroundingState,
  type AiResponseMode,
} from '@herta/plugin-catalog/ai-conversation-policy';
import {
  AiFoundationError,
  AiFoundationService,
  AnthropicMessagesProvider,
  GeminiGenerateContentProvider,
  OpenAiResponsesProvider,
  type AiFoundationConfig,
  type AiGenerationRequest,
  type AiGenerationResponse,
  type AiGuardStore,
  type AiProviderName,
  type AiTelemetrySink,
} from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import type { AiReasoningEffort } from '@herta/plugin-catalog/ai-runtime-policy';

const AI_CHAT_MAX_OUTPUT_TOKENS = 800;

export interface AiRuntimeGenerationRequest extends AiGenerationRequest {
  /** Trusted server-side response shape. Do not bind this directly to arbitrary client input. */
  responseMode?: AiResponseMode;
  /** Trusted retrieval/tool state. Do not allow a client to self-declare successful grounding. */
  groundingState?: AiGroundingState;
  /**
   * Bounded server-authored instructions for a concrete capability such as artifact serialization.
   * Never copy arbitrary user input into this field.
   */
  trustedInstructions?: readonly string[];
}

export interface AiRuntimeRateLimitRequest {
  input: string;
  guildId: string;
  scopeGuildId: string;
  userId: string;
  authorized: boolean;
  pluginEnabled: boolean;
  guildOptIn: boolean;
}

export interface AiRuntimeGenerationService {
  generate(request: AiRuntimeGenerationRequest): Promise<AiGenerationResponse>;
  /**
   * Consume only the shared user/Guild request rate limits without calling a provider or reserving
   * quota. Server-local rejection paths use this before emitting their bounded response.
   */
  consumeRateLimit?(request: AiRuntimeRateLimitRequest): Promise<void>;
}

export interface OpenAiRuntimeGenerationServiceOptions {
  baseConfig: AiFoundationConfig;
  apiKey: string;
  guardStore: AiGuardStore;
  runtimeResolver: AiRuntimeConfigurationResolver;
  telemetry?: AiTelemetrySink;
  fetchImpl?: typeof fetch;
}

/**
 * Request-scoped runtime adapter.
 *
 * The global enable/kill-switch and all numeric guard bounds remain server-side bootstrap
 * configuration. Provider/model/reasoning and conversation policy are resolved once at the
 * start of each request. The cost preflight includes server instructions, while the provider
 * still receives user input and system/developer instructions as separate fields.
 */
export class OpenAiRuntimeGenerationService implements AiRuntimeGenerationService {
  private readonly baseConfig: AiFoundationConfig;
  private readonly apiKey: string;
  private readonly guardStore: AiGuardStore;
  private readonly runtimeResolver: AiRuntimeConfigurationResolver;
  private readonly telemetry: AiTelemetrySink | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiRuntimeGenerationServiceOptions) {
    this.baseConfig = options.baseConfig;
    this.apiKey = options.apiKey;
    this.guardStore = options.guardStore;
    this.runtimeResolver = options.runtimeResolver;
    this.telemetry = options.telemetry;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async consumeRateLimit(request: AiRuntimeRateLimitRequest): Promise<void> {
    if (!this.baseConfig.enabled || this.baseConfig.killSwitch) {
      throw new AiFoundationError('disabled');
    }
    if (!request.authorized || request.scopeGuildId !== request.guildId) {
      throw new AiFoundationError('unauthorized');
    }
    if (!request.pluginEnabled || !request.guildOptIn) {
      throw new AiFoundationError('disabled');
    }

    validateAndNormalizeUserInput(request.input, this.baseConfig);
    const userRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('user', request.guildId, request.userId),
      this.baseConfig.userRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!userRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: userRate.retryAfterMs });
    }

    const guildRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('guild', request.guildId),
      this.baseConfig.guildRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!guildRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: guildRate.retryAfterMs });
    }
  }

  async generate(request: AiRuntimeGenerationRequest): Promise<AiGenerationResponse> {
    let runtime;
    try {
      runtime = await this.runtimeResolver.resolve();
    } catch {
      // Persisted invalid/unsupported runtime configuration must never silently downgrade.
      throw new AiFoundationError('internal_error');
    }

    if (runtime.selection.provider !== 'openai') {
      // Only implemented providers can reach a provider adapter. Future provider PRs extend
      // this dispatch explicitly rather than accepting arbitrary provider strings.
      throw new AiFoundationError('disabled');
    }

    let conversationPolicy: AiConversationPolicy;
    try {
      conversationPolicy = resolveAiConversationPolicy({
        responseMode: request.responseMode,
        groundingState: request.groundingState,
        // Sourced from the live console/env-resolved runtime selection (like provider/model)
        // rather than the bootstrap-only baseConfig, so a Studio change takes effect without restart.
        timezone: runtime.selection.timezone,
      });
      const trustedInstructions = normalizeTrustedInstructions(request.trustedInstructions);
      if (trustedInstructions.length > 0) {
        conversationPolicy = {
          ...conversationPolicy,
          instructions: [conversationPolicy.instructions, ...trustedInstructions].join(' '),
        };
      }
    } catch {
      // Response mode / grounding / capability instructions are trusted server policy inputs.
      throw new AiFoundationError('internal_error');
    }

    const userInput = validateAndNormalizeUserInput(request.input, this.baseConfig);
    const guardedInput = buildGuardedInput(conversationPolicy.instructions, userInput);
    const guardOverhead = guardedInput.slice(0, guardedInput.length - userInput.length);

    const config: AiFoundationConfig = {
      ...this.baseConfig,
      provider: runtime.selection.provider,
      modelProfile: runtime.selection.modelProfile,
      model: runtime.selection.model,
      // Keep ordinary chat on the established 800-token budget even when operators raise the
      // server hard cap for detailed/artifact work. Detailed/artifact requests may use the full
      // configured cap, which is still validated by AiFoundationConfig (maximum 2,048 tokens).
      maxOutputTokens: resolveAiRuntimeOutputTokenBudget(
        this.baseConfig.maxOutputTokens,
        conversationPolicy.responseMode,
      ),
      // User-input limits remain unchanged because userInput is validated above. These expanded
      // bounds only allow AiFoundationService to account for the trusted instruction envelope.
      maxInputChars: this.baseConfig.maxInputChars + characterLength(guardOverhead),
      maxInputBytes: this.baseConfig.maxInputBytes + utf8ByteLength(guardOverhead),
    };
    const provider = new OpenAiResponsesProvider({
      apiKey: this.apiKey,
      fetchImpl: withOpenAiRuntimePolicy(this.fetchImpl, {
        effort: runtime.selection.reasoningEffort,
        conversationPolicy,
        userInput,
      }),
    });
    const service = new AiFoundationService({
      config,
      provider,
      guardStore: this.guardStore,
      telemetry: this.telemetry,
    });

    return service.generate({
      feature: request.feature,
      input: guardedInput,
      guildId: request.guildId,
      scopeGuildId: request.scopeGuildId,
      userId: request.userId,
      authorized: request.authorized,
      pluginEnabled: request.pluginEnabled,
      guildOptIn: request.guildOptIn,
    });
  }
}

export interface AnthropicRuntimeGenerationServiceOptions {
  baseConfig: AiFoundationConfig;
  apiKey: string;
  guardStore: AiGuardStore;
  runtimeResolver: AiRuntimeConfigurationResolver;
  telemetry?: AiTelemetrySink;
  fetchImpl?: typeof fetch;
}

/**
 * Anthropic counterpart to OpenAiRuntimeGenerationService. Structurally identical (same guard
 * order, same conversation-policy resolution, same input/instruction envelope accounting); only
 * the wire-format adapter and the fetchImpl-rewriting policy wrapper differ per provider.
 */
export class AnthropicRuntimeGenerationService implements AiRuntimeGenerationService {
  private readonly baseConfig: AiFoundationConfig;
  private readonly apiKey: string;
  private readonly guardStore: AiGuardStore;
  private readonly runtimeResolver: AiRuntimeConfigurationResolver;
  private readonly telemetry: AiTelemetrySink | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicRuntimeGenerationServiceOptions) {
    this.baseConfig = options.baseConfig;
    this.apiKey = options.apiKey;
    this.guardStore = options.guardStore;
    this.runtimeResolver = options.runtimeResolver;
    this.telemetry = options.telemetry;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async consumeRateLimit(request: AiRuntimeRateLimitRequest): Promise<void> {
    if (!this.baseConfig.enabled || this.baseConfig.killSwitch) {
      throw new AiFoundationError('disabled');
    }
    if (!request.authorized || request.scopeGuildId !== request.guildId) {
      throw new AiFoundationError('unauthorized');
    }
    if (!request.pluginEnabled || !request.guildOptIn) {
      throw new AiFoundationError('disabled');
    }

    validateAndNormalizeUserInput(request.input, this.baseConfig);
    const userRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('user', request.guildId, request.userId),
      this.baseConfig.userRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!userRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: userRate.retryAfterMs });
    }

    const guildRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('guild', request.guildId),
      this.baseConfig.guildRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!guildRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: guildRate.retryAfterMs });
    }
  }

  async generate(request: AiRuntimeGenerationRequest): Promise<AiGenerationResponse> {
    let runtime;
    try {
      runtime = await this.runtimeResolver.resolve();
    } catch {
      throw new AiFoundationError('internal_error');
    }

    if (runtime.selection.provider !== 'anthropic') {
      // Mirrors OpenAiRuntimeGenerationService's explicit allowlist dispatch: only implemented
      // providers reach a provider adapter.
      throw new AiFoundationError('disabled');
    }

    let conversationPolicy: AiConversationPolicy;
    try {
      conversationPolicy = resolveAiConversationPolicy({
        responseMode: request.responseMode,
        groundingState: request.groundingState,
        timezone: runtime.selection.timezone,
      });
      const trustedInstructions = normalizeTrustedInstructions(request.trustedInstructions);
      if (trustedInstructions.length > 0) {
        conversationPolicy = {
          ...conversationPolicy,
          instructions: [conversationPolicy.instructions, ...trustedInstructions].join(' '),
        };
      }
    } catch {
      throw new AiFoundationError('internal_error');
    }

    const userInput = validateAndNormalizeUserInput(request.input, this.baseConfig);
    const guardedInput = buildGuardedInput(conversationPolicy.instructions, userInput);
    const guardOverhead = guardedInput.slice(0, guardedInput.length - userInput.length);

    const config: AiFoundationConfig = {
      ...this.baseConfig,
      provider: runtime.selection.provider,
      modelProfile: runtime.selection.modelProfile,
      model: runtime.selection.model,
      maxOutputTokens: resolveAiRuntimeOutputTokenBudget(
        this.baseConfig.maxOutputTokens,
        conversationPolicy.responseMode,
      ),
      maxInputChars: this.baseConfig.maxInputChars + characterLength(guardOverhead),
      maxInputBytes: this.baseConfig.maxInputBytes + utf8ByteLength(guardOverhead),
    };
    const provider = new AnthropicMessagesProvider({
      apiKey: this.apiKey,
      fetchImpl: withAnthropicRuntimePolicy(this.fetchImpl, {
        effort: runtime.selection.reasoningEffort,
        conversationPolicy,
        userInput,
      }),
    });
    const service = new AiFoundationService({
      config,
      provider,
      guardStore: this.guardStore,
      telemetry: this.telemetry,
    });

    return service.generate({
      feature: request.feature,
      input: guardedInput,
      guildId: request.guildId,
      scopeGuildId: request.scopeGuildId,
      userId: request.userId,
      authorized: request.authorized,
      pluginEnabled: request.pluginEnabled,
      guildOptIn: request.guildOptIn,
    });
  }
}

export interface GoogleRuntimeGenerationServiceOptions {
  baseConfig: AiFoundationConfig;
  apiKey: string;
  guardStore: AiGuardStore;
  runtimeResolver: AiRuntimeConfigurationResolver;
  telemetry?: AiTelemetrySink;
  fetchImpl?: typeof fetch;
}

/**
 * Google/Gemini counterpart to OpenAiRuntimeGenerationService/AnthropicRuntimeGenerationService.
 * Structurally identical (same guard order, same conversation-policy resolution, same
 * input/instruction envelope accounting); only the wire-format adapter and the
 * fetchImpl-rewriting policy wrapper differ per provider.
 */
export class GoogleRuntimeGenerationService implements AiRuntimeGenerationService {
  private readonly baseConfig: AiFoundationConfig;
  private readonly apiKey: string;
  private readonly guardStore: AiGuardStore;
  private readonly runtimeResolver: AiRuntimeConfigurationResolver;
  private readonly telemetry: AiTelemetrySink | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleRuntimeGenerationServiceOptions) {
    this.baseConfig = options.baseConfig;
    this.apiKey = options.apiKey;
    this.guardStore = options.guardStore;
    this.runtimeResolver = options.runtimeResolver;
    this.telemetry = options.telemetry;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async consumeRateLimit(request: AiRuntimeRateLimitRequest): Promise<void> {
    if (!this.baseConfig.enabled || this.baseConfig.killSwitch) {
      throw new AiFoundationError('disabled');
    }
    if (!request.authorized || request.scopeGuildId !== request.guildId) {
      throw new AiFoundationError('unauthorized');
    }
    if (!request.pluginEnabled || !request.guildOptIn) {
      throw new AiFoundationError('disabled');
    }

    validateAndNormalizeUserInput(request.input, this.baseConfig);
    const userRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('user', request.guildId, request.userId),
      this.baseConfig.userRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!userRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: userRate.retryAfterMs });
    }

    const guildRate = await this.guardStore.consumeRateLimit(
      privacyRateKey('guild', request.guildId),
      this.baseConfig.guildRateLimit,
      this.baseConfig.rateWindowMs,
    );
    if (!guildRate.allowed) {
      throw new AiFoundationError('rate_limited', { retryAfterMs: guildRate.retryAfterMs });
    }
  }

  async generate(request: AiRuntimeGenerationRequest): Promise<AiGenerationResponse> {
    let runtime;
    try {
      runtime = await this.runtimeResolver.resolve();
    } catch {
      throw new AiFoundationError('internal_error');
    }

    if (runtime.selection.provider !== 'google') {
      // Mirrors OpenAiRuntimeGenerationService/AnthropicRuntimeGenerationService's explicit
      // allowlist dispatch: only implemented providers reach a provider adapter.
      throw new AiFoundationError('disabled');
    }

    let conversationPolicy: AiConversationPolicy;
    try {
      conversationPolicy = resolveAiConversationPolicy({
        responseMode: request.responseMode,
        groundingState: request.groundingState,
        timezone: runtime.selection.timezone,
      });
      const trustedInstructions = normalizeTrustedInstructions(request.trustedInstructions);
      if (trustedInstructions.length > 0) {
        conversationPolicy = {
          ...conversationPolicy,
          instructions: [conversationPolicy.instructions, ...trustedInstructions].join(' '),
        };
      }
    } catch {
      throw new AiFoundationError('internal_error');
    }

    const userInput = validateAndNormalizeUserInput(request.input, this.baseConfig);
    const guardedInput = buildGuardedInput(conversationPolicy.instructions, userInput);
    const guardOverhead = guardedInput.slice(0, guardedInput.length - userInput.length);

    const config: AiFoundationConfig = {
      ...this.baseConfig,
      provider: runtime.selection.provider,
      modelProfile: runtime.selection.modelProfile,
      model: runtime.selection.model,
      maxOutputTokens: resolveAiRuntimeOutputTokenBudget(
        this.baseConfig.maxOutputTokens,
        conversationPolicy.responseMode,
      ),
      maxInputChars: this.baseConfig.maxInputChars + characterLength(guardOverhead),
      maxInputBytes: this.baseConfig.maxInputBytes + utf8ByteLength(guardOverhead),
    };
    const provider = new GeminiGenerateContentProvider({
      apiKey: this.apiKey,
      fetchImpl: withGoogleRuntimePolicy(this.fetchImpl, {
        effort: runtime.selection.reasoningEffort,
        conversationPolicy,
        userInput,
      }),
    });
    const service = new AiFoundationService({
      config,
      provider,
      guardStore: this.guardStore,
      telemetry: this.telemetry,
    });

    return service.generate({
      feature: request.feature,
      input: guardedInput,
      guildId: request.guildId,
      scopeGuildId: request.scopeGuildId,
      userId: request.userId,
      authorized: request.authorized,
      pluginEnabled: request.pluginEnabled,
      guildOptIn: request.guildOptIn,
    });
  }
}

export interface MultiProviderAiRuntimeGenerationServiceOptions {
  runtimeResolver: AiRuntimeConfigurationResolver;
  services: Partial<Record<AiProviderName, AiRuntimeGenerationService>>;
}

/**
 * Dispatches each request to the sub-service matching the currently resolved runtime provider
 * selection (from Studio/console/env, via runtimeResolver). Never falls back from one provider
 * to another: a provider that resolved without a usable credential (and therefore has no entry
 * in `services`) fails closed with the same 'disabled' category the single-provider services use
 * for any provider they don't implement themselves.
 */
export class MultiProviderAiRuntimeGenerationService implements AiRuntimeGenerationService {
  private readonly runtimeResolver: AiRuntimeConfigurationResolver;
  private readonly services: Partial<Record<AiProviderName, AiRuntimeGenerationService>>;

  constructor(options: MultiProviderAiRuntimeGenerationServiceOptions) {
    this.runtimeResolver = options.runtimeResolver;
    this.services = options.services;
  }

  async consumeRateLimit(request: AiRuntimeRateLimitRequest): Promise<void> {
    const service = Object.values(this.services)[0];
    if (!service?.consumeRateLimit) throw new AiFoundationError('disabled');
    await service.consumeRateLimit(request);
  }

  async generate(request: AiRuntimeGenerationRequest): Promise<AiGenerationResponse> {
    let provider: AiProviderName;
    try {
      const runtime = await this.runtimeResolver.resolve();
      provider = runtime.selection.provider;
    } catch {
      throw new AiFoundationError('internal_error');
    }

    const service = this.services[provider];
    if (!service) {
      // The selected provider has no bootstrapped credential/adapter. Fail closed rather than
      // silently using a different provider's service.
      throw new AiFoundationError('disabled');
    }
    return service.generate(request);
  }
}

export function resolveAiRuntimeOutputTokenBudget(
  configuredMaxOutputTokens: number,
  responseMode: AiResponseMode,
): number {
  return responseMode === 'chat'
    ? Math.min(configuredMaxOutputTokens, AI_CHAT_MAX_OUTPUT_TOKENS)
    : configuredMaxOutputTokens;
}

interface OpenAiRuntimePolicyOptions {
  effort: AiReasoningEffort;
  conversationPolicy: AiConversationPolicy;
  userInput: string;
}

function withOpenAiRuntimePolicy(
  fetchImpl: typeof fetch,
  options: OpenAiRuntimePolicyOptions,
): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new AiFoundationError('internal_error');

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      throw new AiFoundationError('internal_error');
    }
    if (!isRecord(parsed)) throw new AiFoundationError('internal_error');

    const existingText = isRecord(parsed['text']) ? parsed['text'] : {};
    return fetchImpl(input, {
      ...init,
      body: JSON.stringify({
        ...parsed,
        input: options.userInput,
        instructions: options.conversationPolicy.instructions,
        text: {
          ...existingText,
          verbosity: options.conversationPolicy.textVerbosity,
        },
        reasoning: { effort: options.effort },
      }),
    });
  };
}

interface AnthropicRuntimePolicyOptions {
  effort: AiReasoningEffort;
  conversationPolicy: AiConversationPolicy;
  userInput: string;
}

function withAnthropicRuntimePolicy(
  fetchImpl: typeof fetch,
  options: AnthropicRuntimePolicyOptions,
): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new AiFoundationError('internal_error');

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      throw new AiFoundationError('internal_error');
    }
    if (!isRecord(parsed)) throw new AiFoundationError('internal_error');

    // Anthropic's Messages API has no verbosity parameter; fold the same textVerbosity signal
    // OpenAI receives as a structured field into a short system-instruction directive instead so
    // the two providers stay behaviorally aligned.
    const instructions = `${options.conversationPolicy.instructions} Aim for ${options.conversationPolicy.textVerbosity} verbosity in your response length.`;

    const next: Record<string, unknown> = {
      ...parsed,
      system: instructions,
      messages: [{ role: 'user', content: options.userInput }],
    };
    // Divergence from OpenAI's 'none': the shared AiReasoningEffort union's 'none' member is
    // resolved by ai-runtime-policy.ts to mean "this profile's model does not support
    // output_config.effort" (Claude Haiku 4.5 / economy). Sending output_config at all to that
    // model is rejected by Anthropic, so the field must be omitted rather than sent with a
    // placeholder value. For every other Anthropic profile, 'none' is not a valid resolved
    // effort (see AI_RUNTIME_POLICY.anthropic.*.supportedReasoningEfforts in
    // packages/plugin-catalog/src/ai-runtime-policy.ts), so this check never incorrectly drops
    // output_config for a model that does support it.
    if (options.effort === 'none') {
      delete next['output_config'];
    } else {
      next['output_config'] = { effort: options.effort };
    }

    return fetchImpl(input, { ...init, body: JSON.stringify(next) });
  };
}

interface GoogleRuntimePolicyOptions {
  effort: AiReasoningEffort;
  conversationPolicy: AiConversationPolicy;
  userInput: string;
}

function withGoogleRuntimePolicy(
  fetchImpl: typeof fetch,
  options: GoogleRuntimePolicyOptions,
): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new AiFoundationError('internal_error');

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      throw new AiFoundationError('internal_error');
    }
    if (!isRecord(parsed)) throw new AiFoundationError('internal_error');

    // Gemini's generateContent has no system-instruction/verbosity parameter comparable to
    // OpenAI's `instructions`/`text.verbosity` fields; fold both signals into the single user
    // turn the same way AnthropicRuntimePolicy folds verbosity into its system instruction, since
    // Gemini's REST contents array here is a single user-role turn (see
    // GeminiGenerateContentProvider in packages/plugin-catalog/src/ai-service.ts).
    const instructions = `${options.conversationPolicy.instructions} Aim for ${options.conversationPolicy.textVerbosity} verbosity in your response length.`;
    const combinedInput = `${instructions}\n\n${options.userInput}`;

    const existingGenerationConfig = isRecord(parsed['generationConfig'])
      ? parsed['generationConfig']
      : {};
    const existingThinkingConfig = isRecord(existingGenerationConfig['thinkingConfig'])
      ? existingGenerationConfig['thinkingConfig']
      : {};

    // Divergence from OpenAI's 'none' semantics and distinct from Anthropic's: the shared
    // AiReasoningEffort union's 'none' member is resolved by ai-runtime-policy.ts to mean
    // Gemini's "minimal" thinking level, which is only valid for gemini-3.5-flash-lite (economy
    // profile). Every other Gemini profile's supportedReasoningEfforts excludes 'none' (see
    // AI_RUNTIME_POLICY.google.*.supportedReasoningEfforts in
    // packages/plugin-catalog/src/ai-runtime-policy.ts), so this translation is only ever reached
    // for a model that genuinely supports "minimal".
    const thinkingLevel = options.effort === 'none' ? 'minimal' : options.effort;

    const next: Record<string, unknown> = {
      ...parsed,
      contents: [{ role: 'user', parts: [{ text: combinedInput }] }],
      generationConfig: {
        ...existingGenerationConfig,
        thinkingConfig: { ...existingThinkingConfig, thinkingLevel },
      },
    };

    return fetchImpl(input, { ...init, body: JSON.stringify(next) });
  };
}

function validateAndNormalizeUserInput(input: string, config: AiFoundationConfig): string {
  if (typeof input !== 'string') throw new AiFoundationError('invalid_input');
  const normalized = input.trim();
  const chars = characterLength(normalized);
  if (chars < 1 || chars > config.maxInputChars) throw new AiFoundationError('invalid_input');
  if (utf8ByteLength(normalized) > config.maxInputBytes) {
    throw new AiFoundationError('invalid_input');
  }
  return normalized;
}

function normalizeTrustedInstructions(value: readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new AiFoundationError('internal_error');
  return value.map((instruction) => {
    if (typeof instruction !== 'string') throw new AiFoundationError('internal_error');
    const normalized = instruction.trim();
    if (
      characterLength(normalized) < 1 ||
      characterLength(normalized) > 4_000 ||
      utf8ByteLength(normalized) > 12_000 ||
      normalized.includes('\u0000')
    ) {
      throw new AiFoundationError('internal_error');
    }
    return normalized;
  });
}

function buildGuardedInput(instructions: string, userInput: string): string {
  return `Server instructions:\n${instructions}\n\nUser input:\n${userInput}`;
}

function privacyRateKey(kind: 'user' | 'guild', ...values: string[]): string {
  // Keep rate-limit keys identical to AiFoundationService so provider and local rejection paths
  // share the same privacy-safe counters without exposing raw Guild/user identifiers.
  const digest = createHash('sha256').update(values.join('\u0000')).digest('hex').slice(0, 32);
  return `${kind}:${digest}`;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
