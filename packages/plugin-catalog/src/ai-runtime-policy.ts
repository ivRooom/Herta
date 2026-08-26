export const AI_SUPPORTED_PROVIDERS = ['openai'] as const;
export const AI_MODEL_PROFILES = ['quality', 'balanced', 'economy'] as const;
export const AI_OPENAI_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;
export const AI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type AiProviderName = (typeof AI_SUPPORTED_PROVIDERS)[number];
export type AiModelProfile = (typeof AI_MODEL_PROFILES)[number];
export type AiOpenAiModel = (typeof AI_OPENAI_MODELS)[number];
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

export interface AiTokenPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  reviewAfterIso: string | null;
}

export interface AiRuntimePolicyEntry {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  model: AiOpenAiModel;
  supportedReasoningEfforts: readonly AiReasoningEffort[];
  pricing: AiTokenPricing;
}

export interface AiRuntimeSelection {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  model: AiOpenAiModel;
  reasoningEffort: AiReasoningEffort;
  pricing: AiTokenPricing;
}

export interface AiRuntimeStoredValue {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  reasoningEffort: AiReasoningEffort;
}

export type AiRuntimePolicyErrorCode =
  | 'invalid_provider'
  | 'invalid_model_profile'
  | 'invalid_reasoning_effort'
  | 'unsupported_combination'
  | 'invalid_shape';

export class AiRuntimePolicyError extends Error {
  readonly code: AiRuntimePolicyErrorCode;

  constructor(code: AiRuntimePolicyErrorCode) {
    super(`AI runtime policy rejected configuration: ${code}`);
    this.name = 'AiRuntimePolicyError';
    this.code = code;
  }
}

const OPENAI_REASONING_EFFORTS: readonly AiReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * Code-reviewed provider/model/reasoning/pricing policy.
 * Update only after checking the provider's official model and pricing documentation.
 */
const AI_RUNTIME_POLICY: Record<AiProviderName, Record<AiModelProfile, AiRuntimePolicyEntry>> = {
  openai: {
    quality: {
      provider: 'openai',
      modelProfile: 'quality',
      model: 'gpt-5.6-sol',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: {
        inputUsdPerMillion: 4,
        outputUsdPerMillion: 20,
        reviewAfterIso: '2026-11-22T00:00:00.000Z',
      },
    },
    balanced: {
      provider: 'openai',
      modelProfile: 'balanced',
      model: 'gpt-5.6-terra',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: {
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 12,
        reviewAfterIso: null,
      },
    },
    economy: {
      provider: 'openai',
      modelProfile: 'economy',
      model: 'gpt-5.6-luna',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: {
        inputUsdPerMillion: 0.2,
        outputUsdPerMillion: 1.2,
        reviewAfterIso: null,
      },
    },
  },
};

export const AI_RUNTIME_SAFE_DEFAULT: AiRuntimeStoredValue = {
  provider: 'openai',
  modelProfile: 'balanced',
  reasoningEffort: 'low',
};

export function resolveAiRuntimeSelection(value: AiRuntimeStoredValue): AiRuntimeSelection {
  if (!isAiProvider(value.provider)) throw new AiRuntimePolicyError('invalid_provider');
  if (!isAiModelProfile(value.modelProfile)) {
    throw new AiRuntimePolicyError('invalid_model_profile');
  }
  if (!isAiReasoningEffort(value.reasoningEffort)) {
    throw new AiRuntimePolicyError('invalid_reasoning_effort');
  }

  const entry = AI_RUNTIME_POLICY[value.provider][value.modelProfile];
  if (!entry.supportedReasoningEfforts.includes(value.reasoningEffort)) {
    throw new AiRuntimePolicyError('unsupported_combination');
  }

  return {
    provider: entry.provider,
    modelProfile: entry.modelProfile,
    model: entry.model,
    reasoningEffort: value.reasoningEffort,
    pricing: entry.pricing,
  };
}

export function parseAiRuntimeStoredValue(value: unknown): AiRuntimeStoredValue {
  if (!isRecord(value)) throw new AiRuntimePolicyError('invalid_shape');
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes('provider') ||
    !keys.includes('modelProfile') ||
    !keys.includes('reasoningEffort')
  ) {
    throw new AiRuntimePolicyError('invalid_shape');
  }

  const provider = value['provider'];
  const modelProfile = value['modelProfile'];
  const reasoningEffort = value['reasoningEffort'];
  if (typeof provider !== 'string' || !isAiProvider(provider)) {
    throw new AiRuntimePolicyError('invalid_provider');
  }
  if (typeof modelProfile !== 'string' || !isAiModelProfile(modelProfile)) {
    throw new AiRuntimePolicyError('invalid_model_profile');
  }
  if (typeof reasoningEffort !== 'string' || !isAiReasoningEffort(reasoningEffort)) {
    throw new AiRuntimePolicyError('invalid_reasoning_effort');
  }

  const parsed = { provider, modelProfile, reasoningEffort };
  resolveAiRuntimeSelection(parsed);
  return parsed;
}

export function resolveAiRuntimeEnvDefault(
  env: Record<string, string | undefined> = process.env,
): AiRuntimeStoredValue {
  const provider = normalizeOrDefault(env['HERTA_AI_PROVIDER'], AI_RUNTIME_SAFE_DEFAULT.provider);
  const modelProfile = normalizeOrDefault(
    env['HERTA_AI_MODEL_PROFILE'],
    AI_RUNTIME_SAFE_DEFAULT.modelProfile,
  );
  const reasoningEffort = normalizeOrDefault(
    env['HERTA_AI_REASONING_EFFORT'],
    AI_RUNTIME_SAFE_DEFAULT.reasoningEffort,
  );

  const parsed = parseAiRuntimeStoredValue({ provider, modelProfile, reasoningEffort });
  resolveAiRuntimeSelection(parsed);
  return parsed;
}

export function getAiRuntimePolicyMetadata() {
  return AI_SUPPORTED_PROVIDERS.map((provider) => ({
    provider,
    profiles: AI_MODEL_PROFILES.map((modelProfile) => {
      const entry = AI_RUNTIME_POLICY[provider][modelProfile];
      return {
        modelProfile,
        model: entry.model,
        supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
        pricing: { ...entry.pricing },
      };
    }),
  }));
}

export function getAiRuntimePolicyEntry(
  provider: AiProviderName,
  modelProfile: AiModelProfile,
): AiRuntimePolicyEntry {
  return AI_RUNTIME_POLICY[provider][modelProfile];
}

export function getOpenAiRuntimePolicyEntryByModel(model: AiOpenAiModel): AiRuntimePolicyEntry {
  for (const modelProfile of AI_MODEL_PROFILES) {
    const entry = AI_RUNTIME_POLICY.openai[modelProfile];
    if (entry.model === model) return entry;
  }
  throw new AiRuntimePolicyError('invalid_model_profile');
}

export function isAiProvider(value: string): value is AiProviderName {
  return (AI_SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export function isAiModelProfile(value: string): value is AiModelProfile {
  return (AI_MODEL_PROFILES as readonly string[]).includes(value);
}

export function isAiOpenAiModel(value: string): value is AiOpenAiModel {
  return (AI_OPENAI_MODELS as readonly string[]).includes(value);
}

export function isAiReasoningEffort(value: string): value is AiReasoningEffort {
  return (AI_REASONING_EFFORTS as readonly string[]).includes(value);
}

function normalizeOrDefault(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
