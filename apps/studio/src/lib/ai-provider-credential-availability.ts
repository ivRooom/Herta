export type AiProviderCredentialSource = 'runtime_secret' | 'environment';
export type AiProviderCredentialStatus =
  'ready' | 'missing_credential' | 'credential_store_unavailable';

export interface AiProviderCredentialAvailability {
  provider: 'openai';
  available: boolean;
  source: AiProviderCredentialSource | null;
  status: AiProviderCredentialStatus;
}

export async function resolveOpenAiProviderCredentialAvailability(options: {
  readRuntimeCredential: () => Promise<string | null>;
  environmentCredential?: string;
}): Promise<AiProviderCredentialAvailability> {
  try {
    if (await options.readRuntimeCredential()) {
      return {
        provider: 'openai',
        available: true,
        source: 'runtime_secret',
        status: 'ready',
      };
    }
  } catch {
    // Keep the same fail-closed boundary as the Bot runtime: a store/decrypt failure
    // must never activate the environment fallback.
    return {
      provider: 'openai',
      available: false,
      source: null,
      status: 'credential_store_unavailable',
    };
  }

  if (options.environmentCredential?.trim()) {
    return {
      provider: 'openai',
      available: true,
      source: 'environment',
      status: 'ready',
    };
  }

  return {
    provider: 'openai',
    available: false,
    source: null,
    status: 'missing_credential',
  };
}
