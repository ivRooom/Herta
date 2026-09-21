import {
  AI_ANTHROPIC_MODELS,
  AI_DEFAULTS,
  AI_MODEL_PROFILES,
  AI_OPENAI_MODELS,
  AI_SUPPORTED_PROVIDERS,
  estimateAnthropicCostMicroUsd,
  estimateOpenAiCostMicroUsd,
  isValidIanaTimezone,
  type AiAnthropicModel,
  type AiModel,
  type AiModelProfile,
  type AiOpenAiModel,
  type AiProviderName,
} from './ai-service.js';

export {
  AI_ANTHROPIC_MODELS,
  AI_MODEL_PROFILES,
  AI_OPENAI_MODELS,
  AI_SUPPORTED_PROVIDERS,
} from './ai-service.js';
export type {
  AiAnthropicModel,
  AiModel,
  AiModelProfile,
  AiOpenAiModel,
  AiProviderName,
} from './ai-service.js';

export const AI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AI_PROVIDER_CAPABILITIES = ['text', 'code_interpreter', 'image_generation'] as const;

export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];
export type AiProviderCapability = (typeof AI_PROVIDER_CAPABILITIES)[number];

export interface AiTokenPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  reviewAfterIso: string | null;
}

export interface AiRuntimePolicyEntry {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  model: AiModel;
  supportedReasoningEfforts: readonly AiReasoningEffort[];
  pricing: AiTokenPricing;
}

export interface AiRuntimeSelection {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  model: AiModel;
  reasoningEffort: AiReasoningEffort;
  pricing: AiTokenPricing;
  /** IANA timezone used to tell the model today's actual date. */
  timezone: string;
}

export interface AiRuntimeStoredValue {
  provider: AiProviderName;
  modelProfile: AiModelProfile;
  reasoningEffort: AiReasoningEffort;
  /** IANA timezone, e.g. "Asia/Tokyo". Case-sensitive; never lowercased. */
  timezone: string;
}

export type AiRuntimePolicyErrorCode =
  | 'invalid_provider'
  | 'invalid_model_profile'
  | 'invalid_reasoning_effort'
  | 'invalid_timezone'
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
 * Anthropic has no 'none' effort value on the wire; the shared 'none' union member is repurposed
 * here to mean "omit output_config.effort entirely" for models that reject the field outright
 * (Claude Haiku 4.5). See AnthropicMessagesProvider in ai-service.ts for where this is applied.
 */
const ANTHROPIC_FULL_REASONING_EFFORTS: readonly AiReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
const ANTHROPIC_NO_EFFORT_REASONING_EFFORTS: readonly AiReasoningEffort[] = ['none'];

/**
 * Tool/provider capability routing is code-reviewed server policy. Client input may select neither
 * arbitrary provider IDs nor arbitrary tool names. A capability is available only when it is
 * present in this provider allowlist and the matching server adapter is bootstrapped.
 */
const AI_PROVIDER_CAPABILITY_POLICY: Record<AiProviderName, readonly AiProviderCapability[]> = {
  openai: ['text', 'code_interpreter', 'image_generation'],
  // Anthropic integration is plain-text generation only for issue #340; no code-interpreter or
  // image-generation tool adapter exists for this provider yet.
  anthropic: ['text'],
};

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
  anthropic: {
    quality: {
      provider: 'anthropic',
      modelProfile: 'quality',
      model: 'claude-opus-5',
      supportedReasoningEfforts: ANTHROPIC_FULL_REASONING_EFFORTS,
      pricing: anthropicTokenPricing('claude-opus-5', null),
    },
    balanced: {
      provider: 'anthropic',
      modelProfile: 'balanced',
      model: 'claude-sonnet-5',
      supportedReasoningEfforts: ANTHROPIC_FULL_REASONING_EFFORTS,
      pricing: anthropicTokenPricing('claude-sonnet-5', null),
    },
    economy: {
      provider: 'anthropic',
      modelProfile: 'economy',
      // Claude Haiku 4.5 does not support output_config.effort at all. supportedReasoningEfforts
      // is deliberately restricted to ['none'] here so the shared runtime policy validator
      // (resolveAiRuntimeSelection) rejects any other effort for this specific profile, and
      // 'none' is reinterpreted by the Anthropic adapter as "send no output_config field".
      model: 'claude-haiku-4-5-20251001',
      supportedReasoningEfforts: ANTHROPIC_NO_EFFORT_REASONING_EFFORTS,
      pricing: anthropicTokenPricing('claude-haiku-4-5-20251001', null),
    },
  },
};

export const AI_RUNTIME_SAFE_DEFAULT: AiRuntimeStoredValue = {
  provider: 'openai',
  modelProfile: 'balanced',
  reasoningEffort: 'low',
  timezone: AI_DEFAULTS.timezone,
};

export function resolveAiRuntimeSelection(value: AiRuntimeStoredValue): AiRuntimeSelection {
  if (!isAiProvider(value.provider)) throw new AiRuntimePolicyError('invalid_provider');
  if (!isAiModelProfile(value.modelProfile)) {
    throw new AiRuntimePolicyError('invalid_model_profile');
  }
  if (!isAiReasoningEffort(value.reasoningEffort)) {
    throw new AiRuntimePolicyError('invalid_reasoning_effort');
  }
  if (typeof value.timezone !== 'string' || !isValidIanaTimezone(value.timezone)) {
    throw new AiRuntimePolicyError('invalid_timezone');
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
    timezone: value.timezone,
  };
}

export function parseAiRuntimeStoredValue(value: unknown): AiRuntimeStoredValue {
  if (!isRecord(value)) throw new AiRuntimePolicyError('invalid_shape');
  const keys = Object.keys(value);
  // timezoneはこの後に追加したフィールドなので、既存保存済みの3フィールド値(provider/
  // modelProfile/reasoningEffortのみ)も後方互換で受け付け、その場合はsafe defaultへ
  // fallbackする。timezoneキーが存在する場合は依然として厳格に検証する。
  const hasTimezone = keys.includes('timezone');
  if (
    keys.length !== (hasTimezone ? 4 : 3) ||
    !keys.includes('provider') ||
    !keys.includes('modelProfile') ||
    !keys.includes('reasoningEffort')
  ) {
    throw new AiRuntimePolicyError('invalid_shape');
  }

  const provider = value['provider'];
  const modelProfile = value['modelProfile'];
  const reasoningEffort = value['reasoningEffort'];
  const timezone = hasTimezone ? value['timezone'] : AI_RUNTIME_SAFE_DEFAULT.timezone;
  if (typeof provider !== 'string' || !isAiProvider(provider)) {
    throw new AiRuntimePolicyError('invalid_provider');
  }
  if (typeof modelProfile !== 'string' || !isAiModelProfile(modelProfile)) {
    throw new AiRuntimePolicyError('invalid_model_profile');
  }
  if (typeof reasoningEffort !== 'string' || !isAiReasoningEffort(reasoningEffort)) {
    throw new AiRuntimePolicyError('invalid_reasoning_effort');
  }
  if (typeof timezone !== 'string' || !isValidIanaTimezone(timezone)) {
    throw new AiRuntimePolicyError('invalid_timezone');
  }

  const parsed = { provider, modelProfile, reasoningEffort, timezone };
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
  // IANA timezone identifiers are case-sensitive (e.g. "Asia/Tokyo"); never lowercase them.
  const timezone = env['HERTA_AI_TIMEZONE']?.trim() || AI_RUNTIME_SAFE_DEFAULT.timezone;

  const parsed = parseAiRuntimeStoredValue({ provider, modelProfile, reasoningEffort, timezone });
  resolveAiRuntimeSelection(parsed);
  return parsed;
}

export function getAiRuntimePolicyMetadata() {
  return AI_SUPPORTED_PROVIDERS.map((provider) => ({
    provider,
    capabilities: [...AI_PROVIDER_CAPABILITY_POLICY[provider]],
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

export function getAiProviderCapabilities(
  provider: AiProviderName,
): readonly AiProviderCapability[] {
  return AI_PROVIDER_CAPABILITY_POLICY[provider];
}

export function isAiProviderCapabilityEnabled(
  provider: AiProviderName,
  capability: AiProviderCapability,
): boolean {
  return AI_PROVIDER_CAPABILITY_POLICY[provider].includes(capability);
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

export function isAiAnthropicModel(value: string): value is AiAnthropicModel {
  return (AI_ANTHROPIC_MODELS as readonly string[]).includes(value);
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

function anthropicTokenPricing(
  model: AiAnthropicModel,
  reviewAfterIso: string | null,
): AiTokenPricing {
  return {
    inputUsdPerMillion: estimateAnthropicCostMicroUsd(model, 1_000_000, 0) / 1_000_000,
    outputUsdPerMillion: estimateAnthropicCostMicroUsd(model, 0, 1_000_000) / 1_000_000,
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
