import {
  AI_MODEL_PROFILES,
  AI_OPENAI_MODELS,
  AI_SUPPORTED_PROVIDERS,
  estimateOpenAiCostMicroUsd,
  type AiModelProfile,
  type AiOpenAiModel,
  type AiProviderName,
} from './ai-service.js';

export { AI_MODEL_PROFILES, AI_OPENAI_MODELS, AI_SUPPORTED_PROVIDERS } from './ai-service.js';
export type { AiModelProfile, AiOpenAiModel, AiProviderName } from './ai-service.js';

export const AI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

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
 * Code-reviewed provider/model/reasoning policy.
 * Pricing metadata is derived from the same deterministic cost-guard function used by
 * AiFoundationService so Studio display and preflight/settlement cannot drift apart.
 */
const AI_RUNTIME_POLICY: Record<AiProviderName, Record<AiModelProfile, AiRuntimePolicyEntry>> = {
  openai: {
    quality: {
      provider: 'openai',
      modelProfile: 'quality',
      model: 'gpt-5.6-sol',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: openAiTokenPricing('gpt-5.6-sol', '2026-11-22T00:00:00.000Z'),
    },
    balanced: {
      provider: 'openai',
      modelProfile: 'balanced',
      model: 'gpt-5.6-terra',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: openAiTokenPricing('gpt-5.6-terra', null),
    },
    economy: {
      provider: 'openai',
      modelProfile: 'economy',
      model: 'gpt-5.6-luna',
      supportedReasoningEfforts: OPENAI_REASONING_EFFORTS,
      pricing: openAiTokenPricing('gpt-5.6-luna', null),
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

function openAiTokenPricing(model: AiOpenAiModel, reviewAfterIso: string | null): AiTokenPricing {
  return {
    inputUsdPerMillion: estimateOpenAiCostMicroUsd(model, 1_000_000, 0) / 1_000_000,
    outputUsdPerMillion: estimateOpenAiCostMicroUsd(model, 0, 1_000_000) / 1_000_000,
    reviewAfterIso,
  };
}

function normalizeOrDefault(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
