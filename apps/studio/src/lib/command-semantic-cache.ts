import { createHash } from 'node:crypto';
import type { StudioCommandDocumentEmbedding } from './command-semantic-provider.ts';
import type { StudioCommandSemanticDocument } from './command-semantic-search.ts';

export const STUDIO_COMMAND_SEMANTIC_CACHE_MAX_ENTRIES = 8;

export type StudioCommandEmbeddingCacheStatus = 'hit' | 'miss' | 'coalesced';

export interface StudioCommandEmbeddingCacheResult {
  embeddings: readonly StudioCommandDocumentEmbedding[];
  status: StudioCommandEmbeddingCacheStatus;
}

export function buildStudioCommandEmbeddingCacheKey(
  model: string,
  documents: readonly StudioCommandSemanticDocument[],
): string {
  const hash = createHash('sha256');
  hash.update('herta-studio-command-semantic-v1\0');
  hash.update(model);

  for (const document of documents) {
    hash.update('\0');
    hash.update(document.id);
    hash.update('\0');
    hash.update(document.text);
  }

  return hash.digest('hex');
}

export class StudioCommandEmbeddingCache {
  private readonly values = new Map<string, readonly StudioCommandDocumentEmbedding[]>();
  private readonly pending = new Map<
    string,
    Promise<readonly StudioCommandDocumentEmbedding[]>
  >();
  private readonly maxEntries: number;

  constructor(maxEntries = STUDIO_COMMAND_SEMANTIC_CACHE_MAX_ENTRIES) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('maxEntries must be positive');
    }
    this.maxEntries = maxEntries;
  }

  async getOrLoad(
    key: string,
    loader: () => Promise<readonly StudioCommandDocumentEmbedding[]>,
  ): Promise<StudioCommandEmbeddingCacheResult> {
    const cached = this.values.get(key);
    if (cached) {
      this.touch(key, cached);
      return { embeddings: cached, status: 'hit' };
    }

    const existing = this.pending.get(key);
    if (existing) {
      return { embeddings: await existing, status: 'coalesced' };
    }

    const pending = (async () => {
      const loaded = await loader();
      const stored = loaded.map((embedding) => ({
        id: embedding.id,
        vector: [...embedding.vector],
      }));
      this.store(key, stored);
      return stored;
    })();
    this.pending.set(key, pending);

    try {
      return { embeddings: await pending, status: 'miss' };
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }

  private touch(key: string, value: readonly StudioCommandDocumentEmbedding[]) {
    this.values.delete(key);
    this.values.set(key, value);
  }

  private store(key: string, value: readonly StudioCommandDocumentEmbedding[]) {
    this.values.delete(key);
    this.values.set(key, value);

    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      this.values.delete(oldestKey);
    }
  }
}
