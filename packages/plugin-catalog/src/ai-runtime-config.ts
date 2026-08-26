import {
  AI_RUNTIME_CONFIGURATION,
  getRuntimeConfiguration,
  type RuntimeConfigurationRecord,
} from '@herta/db';
import {
  AI_RUNTIME_SAFE_DEFAULT,
  parseAiRuntimeStoredValue,
  resolveAiRuntimeEnvDefault,
  resolveAiRuntimeSelection,
  type AiRuntimeSelection,
  type AiRuntimeStoredValue,
} from './ai-runtime-policy.js';

export type AiRuntimeConfigurationSource = 'console' | 'environment' | 'default';

export interface ResolvedAiRuntimeConfiguration {
  value: AiRuntimeStoredValue;
  selection: AiRuntimeSelection;
  source: AiRuntimeConfigurationSource;
  updatedAt: Date | null;
  storeAvailable: boolean;
}

type RuntimeConfigurationPrisma = Parameters<typeof getRuntimeConfiguration>[0];
type RuntimeConfigurationReader = typeof getRuntimeConfiguration;

export interface AiRuntimeConfigurationResolverOptions {
  prisma: RuntimeConfigurationPrisma;
  env?: Record<string, string | undefined>;
  ttlMs?: number;
  now?: () => number;
  readConfiguration?: RuntimeConfigurationReader;
}

interface CachedRuntimeConfiguration {
  expiresAt: number;
  value: ResolvedAiRuntimeConfiguration;
}

const DEFAULT_TTL_MS = 5_000;
const MAX_TTL_MS = 60_000;

/**
 * Resolve the global non-secret AI runtime selection with bounded staleness.
 *
 * Precedence:
 * 1. valid console runtime setting
 * 2. allowlisted env default
 * 3. hard-coded safe default
 *
 * A storage read failure falls back to the allowlisted env/default configuration because
 * the setting itself is non-secret. A persisted but invalid value is deliberately not
 * downgraded: parsing throws and the provider request fails closed until an administrator
 * corrects the stored configuration.
 */
export class AiRuntimeConfigurationResolver {
  private readonly prisma: RuntimeConfigurationPrisma;
  private readonly env: Record<string, string | undefined>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly readConfiguration: RuntimeConfigurationReader;
  private cache: CachedRuntimeConfiguration | null = null;

  constructor(options: AiRuntimeConfigurationResolverOptions) {
    this.prisma = options.prisma;
    this.env = options.env ?? process.env;
    this.ttlMs = normalizeTtl(options.ttlMs ?? DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
    this.readConfiguration = options.readConfiguration ?? getRuntimeConfiguration;
  }

  async resolve(): Promise<ResolvedAiRuntimeConfiguration> {
    const now = this.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache.value;

    const fallback = resolveFallback(this.env);
    let stored: RuntimeConfigurationRecord | null;
    try {
      stored = await this.readConfiguration(this.prisma, AI_RUNTIME_CONFIGURATION);
    } catch {
      const resolved = {
        ...fallback,
        storeAvailable: false,
      } satisfies ResolvedAiRuntimeConfiguration;
      this.cache = { expiresAt: now + this.ttlMs, value: resolved };
      return resolved;
    }

    if (!stored) {
      const resolved = {
        ...fallback,
        storeAvailable: true,
      } satisfies ResolvedAiRuntimeConfiguration;
      this.cache = { expiresAt: now + this.ttlMs, value: resolved };
      return resolved;
    }

    const value = parseAiRuntimeStoredValue(stored.value);
    const resolved = {
      value,
      selection: resolveAiRuntimeSelection(value),
      source: 'console' as const,
      updatedAt: stored.updatedAt,
      storeAvailable: true,
    } satisfies ResolvedAiRuntimeConfiguration;
    this.cache = { expiresAt: now + this.ttlMs, value: resolved };
    return resolved;
  }

  clearCache(): void {
    this.cache = null;
  }
}

function resolveFallback(
  env: Record<string, string | undefined>,
): Omit<ResolvedAiRuntimeConfiguration, 'storeAvailable'> {
  const hasExplicitEnvDefault = Boolean(
    env['HERTA_AI_PROVIDER']?.trim() ||
      env['HERTA_AI_MODEL_PROFILE']?.trim() ||
      env['HERTA_AI_REASONING_EFFORT']?.trim(),
  );
  const value = hasExplicitEnvDefault ? resolveAiRuntimeEnvDefault(env) : AI_RUNTIME_SAFE_DEFAULT;
  return {
    value,
    selection: resolveAiRuntimeSelection(value),
    source: hasExplicitEnvDefault ? 'environment' : 'default',
    updatedAt: null,
  };
}

function normalizeTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TTL_MS) {
    throw new RangeError('AI runtime configuration TTL is invalid');
  }
  return value;
}
