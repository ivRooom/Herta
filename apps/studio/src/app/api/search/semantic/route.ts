import { NextResponse } from 'next/server';
import {
  OPENAI_API_KEY_RUNTIME_SECRET,
  readRuntimeSecret,
  RuntimeSecretError,
} from '@herta/db';
import { auth } from '@/auth';
import { RequestBodyTooLargeError, readJsonBodyWithLimit } from '@/lib/bounded-request-body';
import {
  buildStudioCommandEmbeddingCacheKey,
  StudioCommandEmbeddingCache,
} from '@/lib/command-semantic-cache';
import {
  embedStudioSemanticTextsWithOpenAI,
  FixedWindowRateLimiter,
  resolveStudioSemanticEmbeddingModel,
  scoreStudioCommandsFromEmbeddings,
  STUDIO_COMMAND_SEMANTIC_RATE_LIMIT,
  STUDIO_COMMAND_SEMANTIC_RATE_MAX_KEYS,
  STUDIO_COMMAND_SEMANTIC_RATE_WINDOW_MS,
  StudioSemanticProviderError,
} from '@/lib/command-semantic-provider';
import {
  buildStudioCommandSemanticDocuments,
  parseStudioCommandSemanticRequest,
  STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD,
} from '@/lib/command-semantic-search';
import { prisma } from '@/lib/db';
import { getManageableGuild } from '@/lib/guilds';
import { isSameOriginMutationRequest } from '@/lib/request-origin';
import { getDiscordAccessToken } from '@/lib/session';
import {
  buildStudioCommandItems,
  STUDIO_COMMAND_SEARCH_RESULT_LIMIT,
} from '@/lib/studio-navigation';

export const dynamic = 'force-dynamic';

const MAX_SEMANTIC_SEARCH_BODY_BYTES = 2 * 1024;
const semanticRateLimiter = new FixedWindowRateLimiter(
  STUDIO_COMMAND_SEMANTIC_RATE_LIMIT,
  STUDIO_COMMAND_SEMANTIC_RATE_WINDOW_MS,
  STUDIO_COMMAND_SEMANTIC_RATE_MAX_KEYS,
);
const semanticDocumentEmbeddingCache = new StudioCommandEmbeddingCache();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLocaleLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'application/jsonが必要です' }, { status: 415 });
  }

  const body = await parseBody(request);
  if ('response' in body) return body.response;
  const parsed = parseStudioCommandSemanticRequest(body.value);
  if (!parsed) {
    return NextResponse.json({ error: '検索条件が不正です' }, { status: 400 });
  }

  const provider = process.env.STUDIO_SEMANTIC_SEARCH_PROVIDER?.trim().toLocaleLowerCase();
  if (provider !== 'openai') {
    return NextResponse.json({ mode: 'disabled', scores: [] });
  }

  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) {
    console.warn('Studio semantic search provider is enabled without a usable OpenAI credential');
    return NextResponse.json({ mode: 'fallback', scores: [] });
  }

  const rate = semanticRateLimiter.consume(session.user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { mode: 'fallback', scores: [] },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) },
      },
    );
  }

  let guildName: string | null = null;
  if (parsed.guildId) {
    const accessToken = await getDiscordAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: 'Discordの再ログインが必要です' }, { status: 401 });
    }

    try {
      const guild = await getManageableGuild(accessToken, parsed.guildId);
      if (!guild) {
        return NextResponse.json({ error: 'このGuildを管理する権限がありません' }, { status: 403 });
      }
      guildName = guild.name;
    } catch (error) {
      console.warn('Studio semantic search Guild authorization lookup failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return NextResponse.json({ mode: 'fallback', scores: [] });
    }
  }

  const commands = buildStudioCommandItems(parsed.guildId, guildName);
  const documents = buildStudioCommandSemanticDocuments(commands);
  const model = resolveStudioSemanticEmbeddingModel(process.env.OPENAI_EMBEDDING_MODEL);
  const cacheKey = buildStudioCommandEmbeddingCacheKey(model, documents);
  const startedAt = Date.now();

  try {
    const documentEmbeddingsPromise = semanticDocumentEmbeddingCache.getOrLoad(
      cacheKey,
      async () => {
        const vectors = await embedStudioSemanticTextsWithOpenAI({
          apiKey,
          model,
          texts: documents.map((document) => document.text),
        });
        return documents.map((document, index) => {
          const vector = vectors[index];
          if (!vector) throw new StudioSemanticProviderError('malformed_response');
          return { id: document.id, vector };
        });
      },
    );
    const queryEmbeddingPromise = embedStudioSemanticTextsWithOpenAI({
      apiKey,
      model,
      texts: [parsed.query],
    });

    const [cacheResult, queryVectors] = await Promise.all([
      documentEmbeddingsPromise,
      queryEmbeddingPromise,
    ]);
    const queryVector = queryVectors[0];
    if (!queryVector) throw new StudioSemanticProviderError('malformed_response');

    const scores = scoreStudioCommandsFromEmbeddings(queryVector, cacheResult.embeddings);
    const boundedScores = scores
      .filter((candidate) => candidate.score >= STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD)
      .sort((left, right) => right.score - left.score)
      .slice(0, STUDIO_COMMAND_SEARCH_RESULT_LIMIT);

    return NextResponse.json({ mode: 'semantic', scores: boundedScores });
  } catch (error) {
    console.warn('Studio semantic search provider failed; lexical fallback remains active', {
      provider: 'openai',
      failure:
        error instanceof StudioSemanticProviderError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'UnknownError',
      candidateCount: documents.length,
      hasGuildContext: parsed.guildId !== null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ mode: 'fallback', scores: [] });
  }
}

async function resolveOpenAiApiKey(): Promise<string | null> {
  try {
    const stored = await readRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET);
    if (stored) return stored;
  } catch (error) {
    if (error instanceof RuntimeSecretError) {
      console.warn('Studio semantic runtime credential cannot be decrypted', {
        provider: 'openai',
        failure: error.code,
      });
      return null;
    }
    console.warn('Studio semantic runtime credential store is unavailable; env fallback remains active', {
      provider: 'openai',
      failure: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return process.env.OPENAI_API_KEY?.trim() || null;
}

async function parseBody(request: Request): Promise<{ value: unknown } | { response: Response }> {
  try {
    return { value: await readJsonBodyWithLimit(request, MAX_SEMANTIC_SEARCH_BODY_BYTES) };
  } catch (error) {
    return {
      response: NextResponse.json(
        {
          error:
            error instanceof RequestBodyTooLargeError
              ? '検索リクエストが大きすぎます'
              : 'JSONが不正です',
        },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      ),
    };
  }
}
