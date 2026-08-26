import { OPENAI_API_KEY_RUNTIME_SECRET, RuntimeSecretError, readRuntimeSecret } from '@herta/db';
import {
  AiFoundationService,
  OpenAiResponsesProvider,
  RedisAiGuardStore,
  resolveAiFoundationConfig,
  type AiTelemetrySink,
  type RedisEvalClient,
} from '@herta/plugin-catalog/ai-service';

type RuntimeSecretPrisma = Parameters<typeof readRuntimeSecret>[0];
type RuntimeSecretReader = typeof readRuntimeSecret;

export type AiCredentialSource = 'runtime_secret' | 'environment';
export type AiRuntimeBootstrapStatus = 'disabled' | 'credential_unavailable' | 'ready';

export interface AiCredentialResolution {
  apiKey: string | null;
  source: AiCredentialSource | null;
  failure: string | null;
}

export interface AiFoundationRuntimeBootstrap {
  service: AiFoundationService | null;
  status: AiRuntimeBootstrapStatus;
  credentialSource: AiCredentialSource | null;
}

export interface AiFoundationRuntimeOptions {
  prisma: RuntimeSecretPrisma;
  redis: RedisEvalClient;
  env?: Record<string, string | undefined>;
  telemetry?: AiTelemetrySink;
  readSecret?: RuntimeSecretReader;
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
 * 実際のDiscord Q&A surfaceは後続PRからこのserviceを利用する。
 */
export async function createAiFoundationRuntime(
  options: AiFoundationRuntimeOptions,
): Promise<AiFoundationRuntimeBootstrap> {
  const env = options.env ?? process.env;
  const config = resolveAiFoundationConfig(env);
  if (!config.enabled || config.killSwitch) {
    return { service: null, status: 'disabled', credentialSource: null };
  }

  const credential = await resolveAiOpenAiCredential(options);
  if (!credential.apiKey) {
    return { service: null, status: 'credential_unavailable', credentialSource: null };
  }

  return {
    service: new AiFoundationService({
      config,
      provider: new OpenAiResponsesProvider({ apiKey: credential.apiKey }),
      guardStore: new RedisAiGuardStore({ redis: options.redis }),
      telemetry: options.telemetry,
    }),
    status: 'ready',
    credentialSource: credential.source,
  };
}
