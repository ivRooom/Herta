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
  OpenAiResponsesProvider,
  type AiFoundationConfig,
  type AiGenerationRequest,
  type AiGenerationResponse,
  type AiGuardStore,
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
