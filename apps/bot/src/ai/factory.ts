import {
  OPENAI_API_KEY_RUNTIME_SECRET,
  RuntimeSecretError,
  getRuntimeConfiguration,
  readRuntimeSecret,
} from '@herta/db';
import {
  RedisAiGuardStore,
  resolveAiFoundationConfig,
  type AiTelemetrySink,
  type RedisEvalClient,
} from '@herta/plugin-catalog/ai-service';
import { AiRuntimeConfigurationResolver } from '@herta/plugin-catalog/ai-runtime-config';
import { AI_RUNTIME_SAFE_DEFAULT } from '@herta/plugin-catalog/ai-runtime-policy';
import {
  OpenAiCodeExecutionService,
  type AiCodeExecutionService,
} from './code-execution-service.js';
import {
  OpenAiImageGenerationService,
  type AiImageGenerationService,
} from './image-generation-service.js';
import {
  OpenAiRuntimeGenerationService,
  type AiRuntimeGenerationService,
} from './runtime-service.js';

type RuntimeSecretPrisma = Parameters<typeof readRuntimeSecret>[0];
type RuntimeConfigurationPrisma = Parameters<typeof getRuntimeConfiguration>[0];
type AiRuntimePrisma = RuntimeSecretPrisma & RuntimeConfigurationPrisma;
type RuntimeSecretReader = typeof readRuntimeSecret;
type RuntimeConfigurationReader = typeof getRuntimeConfiguration;

export type AiCredentialSource = 'runtime_secret' | 'environment';
export type AiRuntimeBootstrapStatus = 'disabled' | 'credential_unavailable' | 'ready';

export interface AiCredentialResolution {
  apiKey: string | null;
  source: AiCredentialSource | null;
  failure: string | null;
}

export interface AiFoundationRuntimeBootstrap {
  service: AiRuntimeGenerationService | null;
  executionService?: AiCodeExecutionService | null;
  imageGenerationService?: AiImageGenerationService | null;
  status: AiRuntimeBootstrapStatus;
  credentialSource: AiCredentialSource | null;
}

export interface AiFoundationRuntimeOptions {
  prisma: AiRuntimePrisma;
  redis: RedisEvalClient;
  env?: Record<string, string | undefined>;
  telemetry?: AiTelemetrySink;
  readSecret?: RuntimeSecretReader;
  readRuntimeConfiguration?: RuntimeConfigurationReader;
  runtimeConfigTtlMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Runtime Secret Storeを最優先し、まだconsole credentialが無い場合だけenv fallbackを使う。
 * Runtime Secret Storeのread/decrypt障害はfail closedし、envへ逃がさない。
 */
export async function resolveAiOpenAiCredential(
  options: Pick<AiFoundationRuntimeOptions, 'prisma' | 'env' | 'readSecret'>,
): Promise<AiCredentialResolution> {
  const env = options.env ?? process.env;
  const readSecret = options.readSecret ?? readRuntimeSecret;
  try {
    const stored = await readSecret(options.prisma, OPENAI_API_KEY_RUNTIME_SECRET, env);
    if (stored) return { apiKey: stored, source: 'runtime_secret', failure: null };
  } catch (error) {
    const failure = error instanceof RuntimeSecretError ? error.code : 'runtime_secret_unavailable';
    return { apiKey: null, source: null, failure };
  }

  const fallback = env['OPENAI_API_KEY']?.trim();
  return fallback
    ? { apiKey: fallback, source: 'environment', failure: null }
    : { apiKey: null, source: null, failure: 'missing_credential' };
}

/**
 * Bot-side bootstrap。AIがOFF/kill-switch中、またはcredential不成立でもBot本体は起動可能にする。
 * Global enable / kill-switchはconsole runtime settingに移さずenv gateのまま維持する。
 * Model/reasoningはrequest-time resolverが最大5秒程度のbounded staleで追随する。
 */
export async function createAiFoundationRuntime(
  options: AiFoundationRuntimeOptions,
): Promise<AiFoundationRuntimeBootstrap> {
  const env = options.env ?? process.env;
  const baseConfig = resolveAiFoundationConfig({
    ...env,
    HERTA_AI_PROVIDER: AI_RUNTIME_SAFE_DEFAULT.provider,
    HERTA_AI_MODEL_PROFILE: AI_RUNTIME_SAFE_DEFAULT.modelProfile,
    HERTA_AI_MODEL: undefined,
  });
  if (!baseConfig.enabled || baseConfig.killSwitch) {
    return { service: null, status: 'disabled', credentialSource: null };
  }

  const credential = await resolveAiOpenAiCredential(options);
  if (!credential.apiKey) {
    return { service: null, status: 'credential_unavailable', credentialSource: null };
  }

  const runtimeResolver = new AiRuntimeConfigurationResolver({
    prisma: options.prisma,
    env,
    ttlMs: options.runtimeConfigTtlMs,
    readConfiguration: options.readRuntimeConfiguration,
  });
  const guardStore = new RedisAiGuardStore({ redis: options.redis });
  const imageToolGuardStore = new RedisAiGuardStore({
    redis: options.redis,
    prefix: 'herta:ai:image-generation',
  });
  const service = new OpenAiRuntimeGenerationService({
    baseConfig,
    apiKey: credential.apiKey,
    guardStore,
    runtimeResolver,
    telemetry: options.telemetry,
    fetchImpl: options.fetchImpl,
  });
  const executionService = new OpenAiCodeExecutionService({
    baseConfig,
    apiKey: credential.apiKey,
    guardStore,
    runtimeResolver,
    telemetry: options.telemetry,
    fetchImpl: options.fetchImpl,
  });
  const imageGenerationService = new OpenAiImageGenerationService({
    baseConfig,
    apiKey: credential.apiKey,
    guardStore,
    toolGuardStore: imageToolGuardStore,
    runtimeResolver,
    telemetry: options.telemetry,
    fetchImpl: options.fetchImpl,
  });

  return {
    service,
    executionService,
    imageGenerationService,
    status: 'ready',
    credentialSource: credential.source,
  };
}
