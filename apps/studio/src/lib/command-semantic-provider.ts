import type {
  StudioCommandSemanticDocument,
  StudioCommandSemanticScore,
} from './command-semantic-search.ts';

export const STUDIO_COMMAND_SEMANTIC_PROVIDER_TIMEOUT_MS = 1200;
export const STUDIO_COMMAND_SEMANTIC_PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const STUDIO_COMMAND_SEMANTIC_RATE_LIMIT = 20;
export const STUDIO_COMMAND_SEMANTIC_RATE_WINDOW_MS = 60_000;
export const STUDIO_COMMAND_SEMANTIC_RATE_MAX_KEYS = 5000;

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

type SemanticFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type StudioSemanticProviderErrorCode =
  'timeout' | 'network' | 'non_2xx' | 'response_too_large' | 'malformed_response';

export class StudioSemanticProviderError extends Error {
  readonly code: StudioSemanticProviderErrorCode;

  constructor(code: StudioSemanticProviderErrorCode) {
    super(`Studio semantic provider failed: ${code}`);
    this.code = code;
    this.name = 'StudioSemanticProviderError';
  }
}

export interface StudioCommandDocumentEmbedding {
  id: string;
  vector: readonly number[];
}

export interface OpenAIStudioEmbeddingOptions {
  apiKey: string;
  model?: string;
  texts: readonly string[];
  fetchImpl?: SemanticFetch;
  timeoutMs?: number;
}

export interface OpenAIStudioSemanticOptions {
  apiKey: string;
  model?: string;
  query: string;
  documents: readonly StudioCommandSemanticDocument[];
  fetchImpl?: SemanticFetch;
  timeoutMs?: number;
}

export function resolveStudioSemanticEmbeddingModel(value: string | undefined): string {
  const model = value?.trim();
  if (!model || model.length > 100) return DEFAULT_OPENAI_EMBEDDING_MODEL;
  return model;
}

export async function embedStudioSemanticTextsWithOpenAI(
  options: OpenAIStudioEmbeddingOptions,
): Promise<number[][]> {
  if (options.texts.length === 0) return [];

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = resolveStudioSemanticEmbeddingModel(options.model);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? STUDIO_COMMAND_SEMANTIC_PROVIDER_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: options.texts,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new StudioSemanticProviderError('timeout');
    throw new StudioSemanticProviderError('network');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new StudioSemanticProviderError('non_2xx');

  const payload = await readBoundedJson(
    response,
    STUDIO_COMMAND_SEMANTIC_PROVIDER_RESPONSE_MAX_BYTES,
  );
  return parseEmbeddingVectors(payload, options.texts.length);
}

export function scoreStudioCommandsFromEmbeddings(
  queryVector: readonly number[],
  documentEmbeddings: readonly StudioCommandDocumentEmbedding[],
): StudioCommandSemanticScore[] {
  if (queryVector.length === 0) throw new StudioSemanticProviderError('malformed_response');

  return documentEmbeddings.map((document) => {
    if (document.vector.length !== queryVector.length) {
      throw new StudioSemanticProviderError('malformed_response');
    }
    return {
      id: document.id,
      score: cosineSimilarity(queryVector, document.vector),
    };
  });
}

export async function scoreStudioCommandsWithOpenAI(
  options: OpenAIStudioSemanticOptions,
): Promise<StudioCommandSemanticScore[]> {
  const vectors = await embedStudioSemanticTextsWithOpenAI({
    apiKey: options.apiKey,
    model: options.model,
    texts: [options.query, ...options.documents.map((document) => document.text)],
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const queryVector = vectors[0];
  if (!queryVector) throw new StudioSemanticProviderError('malformed_response');

  const documentEmbeddings = options.documents.map((document, index) => {
    const vector = vectors[index + 1];
    if (!vector) throw new StudioSemanticProviderError('malformed_response');
    return { id: document.id, vector };
  });

  return scoreStudioCommandsFromEmbeddings(queryVector, documentEmbeddings);
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new RangeError('windowMs must be positive');
    }
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
      throw new RangeError('maxKeys must be positive');
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    this.prune(now);
    const current = this.buckets.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.ensureCapacity(now);
      this.buckets.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, this.windowMs - (now - current.start)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start >= this.windowMs) this.buckets.delete(key);
    }
  }

  private ensureCapacity(now: number) {
    if (this.buckets.size < this.maxKeys) return;
    this.prune(now);
    if (this.buckets.size < this.maxKeys) return;
    const oldestKey = this.buckets.keys().next().value;
    if (typeof oldestKey === 'string') this.buckets.delete(oldestKey);
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new StudioSemanticProviderError('response_too_large');
  }
  if (!response.body) throw new StudioSemanticProviderError('malformed_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new StudioSemanticProviderError('response_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new StudioSemanticProviderError('malformed_response');
  }
}

function parseEmbeddingVectors(value: unknown, expectedCount: number): number[][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StudioSemanticProviderError('malformed_response');
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new StudioSemanticProviderError('malformed_response');
  }

  const vectors = new Array<number[] | undefined>(expectedCount);
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new StudioSemanticProviderError('malformed_response');
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.index !== 'number' || !Number.isSafeInteger(record.index)) {
      throw new StudioSemanticProviderError('malformed_response');
    }
    if (record.index < 0 || record.index >= expectedCount || vectors[record.index]) {
      throw new StudioSemanticProviderError('malformed_response');
    }
    if (!Array.isArray(record.embedding) || record.embedding.length === 0) {
      throw new StudioSemanticProviderError('malformed_response');
    }
    const vector: number[] = [];
    for (const component of record.embedding) {
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        throw new StudioSemanticProviderError('malformed_response');
      }
      vector.push(component);
    }
    vectors[record.index] = vector;
  }

  const resolved = vectors.filter((vector): vector is number[] => vector !== undefined);
  if (resolved.length !== expectedCount)
    throw new StudioSemanticProviderError('malformed_response');
  const dimension = resolved[0]?.length ?? 0;
  if (dimension === 0 || resolved.some((vector) => vector.length !== dimension)) {
    throw new StudioSemanticProviderError('malformed_response');
  }
  return resolved;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return Math.max(0, Math.min(1, similarity));
}
