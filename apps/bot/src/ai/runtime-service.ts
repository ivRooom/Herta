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

export interface AiRuntimeGenerationService {
  generate(request: AiGenerationRequest): Promise<AiGenerationResponse>;
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
 * configuration. Provider/model/reasoning are resolved once at the start of each request,
 * then the hardened AiFoundationService receives one immutable snapshot so model pricing,
 * quota reservation and the provider request cannot diverge during the same generation.
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

  async generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
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

    const config: AiFoundationConfig = {
      ...this.baseConfig,
      provider: runtime.selection.provider,
      modelProfile: runtime.selection.modelProfile,
      model: runtime.selection.model,
    };
    const provider = new OpenAiResponsesProvider({
      apiKey: this.apiKey,
      fetchImpl: withOpenAiReasoning(this.fetchImpl, runtime.selection.reasoningEffort),
    });
    const service = new AiFoundationService({
      config,
      provider,
      guardStore: this.guardStore,
      telemetry: this.telemetry,
    });
    return service.generate(request);
  }
}

function withOpenAiReasoning(fetchImpl: typeof fetch, effort: AiReasoningEffort): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new AiFoundationError('internal_error');

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      throw new AiFoundationError('internal_error');
    }
    if (!isRecord(parsed)) throw new AiFoundationError('internal_error');

    return fetchImpl(input, {
      ...init,
      body: JSON.stringify({
        ...parsed,
        reasoning: { effort },
      }),
    });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
