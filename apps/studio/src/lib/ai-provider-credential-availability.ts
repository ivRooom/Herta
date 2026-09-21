export type AiProviderCredentialSource = 'runtime_secret' | 'environment';
export type AiProviderCredentialStatus =
  'ready' | 'missing_credential' | 'credential_store_unavailable';

export interface AiProviderCredentialAvailability {
  provider: 'openai' | 'anthropic';
  available: boolean;
  source: AiProviderCredentialSource | null;
  status: AiProviderCredentialStatus;
}

async function resolveAiProviderCredentialAvailability(
  provider: 'openai' | 'anthropic',
  options: {
    readRuntimeCredential: () => Promise<string | null>;
    environmentCredential?: string;
  },
): Promise<AiProviderCredentialAvailability> {
  try {
    if (await options.readRuntimeCredential()) {
      return {
        provider,
        available: true,
        source: 'runtime_secret',
        status: 'ready',
      };
    }
  } catch {
    // Keep the same fail-closed boundary as the Bot runtime: a store/decrypt failure
    // must never activate the environment fallback.
    return {
      provider,
      available: false,
      source: null,
      status: 'credential_store_unavailable',
    };
  }

  if (options.environmentCredential?.trim()) {
    return {
      provider,
      available: true,
      source: 'environment',
      status: 'ready',
    };
  }

  return {
    provider,
    available: false,
    source: null,
    status: 'missing_credential',
  };
}

export async function resolveOpenAiProviderCredentialAvailability(options: {
  readRuntimeCredential: () => Promise<string | null>;
  environmentCredential?: string;
}): Promise<AiProviderCredentialAvailability> {
  return resolveAiProviderCredentialAvailability('openai', options);
}

export async function resolveAnthropicProviderCredentialAvailability(options: {
  readRuntimeCredential: () => Promise<string | null>;
  environmentCredential?: string;
}): Promise<AiProviderCredentialAvailability> {
  return resolveAiProviderCredentialAvailability('anthropic', options);
}
