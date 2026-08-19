import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudioCommandEmbeddingCacheKey,
  StudioCommandEmbeddingCache,
} from './command-semantic-cache.ts';
import {
  embedStudioSemanticTextsWithOpenAI,
  resolveStudioSemanticEmbeddingModel,
  scoreStudioCommandsFromEmbeddings,
  StudioSemanticProviderError,
} from './command-semantic-provider.ts';
import { buildStudioCommandSemanticDocuments } from './command-semantic-search.ts';
import { buildStudioCommandItems } from './studio-navigation.ts';

const GUILD_ID_A = '123456789012345678';
const GUILD_ID_B = '987654321098765432';

test('semantic embedding cache keyはGuild固有値を含まずmodel/corpus変更でinvalidateする', () => {
  const documentsA = buildStudioCommandSemanticDocuments(
    buildStudioCommandItems(GUILD_ID_A, 'Private Guild A'),
  );
  const documentsB = buildStudioCommandSemanticDocuments(
    buildStudioCommandItems(GUILD_ID_B, 'Private Guild B'),
  );
  const model = resolveStudioSemanticEmbeddingModel(undefined);

  const keyA = buildStudioCommandEmbeddingCacheKey(model, documentsA);
  const keyB = buildStudioCommandEmbeddingCacheKey(model, documentsB);
  assert.equal(keyA, keyB);
  assert.notEqual(buildStudioCommandEmbeddingCacheKey('another-model', documentsA), keyA);
  assert.notEqual(
    buildStudioCommandEmbeddingCacheKey(model, [
      ...documentsA,
      { id: 'future-command', text: 'label: Future command' },
    ]),
    keyA,
  );
});

test('semantic embedding cacheは同一corpusの並行missをcoalesceして再利用する', async () => {
  const cache = new StudioCommandEmbeddingCache(2);
  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return [{ id: 'one', vector: [1, 0] }];
  };

  const [first, second] = await Promise.all([
    cache.getOrLoad('same-key', loader),
    cache.getOrLoad('same-key', loader),
  ]);

  assert.equal(loadCount, 1);
  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'coalesced');
  assert.deepEqual(first.embeddings, second.embeddings);

  const third = await cache.getOrLoad('same-key', loader);
  assert.equal(third.status, 'hit');
  assert.equal(loadCount, 1);
});

test('semantic embedding cacheはLRU上限を超えた古いcorpusを破棄する', async () => {
  const cache = new StudioCommandEmbeddingCache(2);
  const load = async (id: string) => [{ id, vector: [1, 0] }];

  await cache.getOrLoad('a', () => load('a'));
  await cache.getOrLoad('b', () => load('b'));
  assert.equal((await cache.getOrLoad('a', () => load('a'))).status, 'hit');
  await cache.getOrLoad('c', () => load('c'));

  assert.equal((await cache.getOrLoad('b', () => load('b'))).status, 'miss');
});

test('warm cache用query embeddingはqueryだけをproviderへ送信できる', async () => {
  const vectors = await embedStudioSemanticTextsWithOpenAI({
    apiKey: 'test-key',
    model: ' text-embedding-3-small ',
    texts: ['予約投稿したい'],
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key');
      assert.equal(typeof init?.body, 'string');
      const body = JSON.parse(init?.body as string) as { model: string; input: string[] };
      assert.equal(body.model, 'text-embedding-3-small');
      assert.deepEqual(body.input, ['予約投稿したい']);
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.deepEqual(vectors, [[1, 0]]);
});

test('cached document embeddingとquery embeddingのdimension不一致を拒否する', () => {
  assert.throws(
    () => scoreStudioCommandsFromEmbeddings([1, 0], [{ id: 'one', vector: [1] }]),
    (error: unknown) =>
      error instanceof StudioSemanticProviderError && error.code === 'malformed_response',
  );
});

test('semantic model名はtrimし、不正長では既定modelへ戻す', () => {
  assert.equal(resolveStudioSemanticEmbeddingModel(' custom-model '), 'custom-model');
  assert.equal(resolveStudioSemanticEmbeddingModel('x'.repeat(101)), 'text-embedding-3-small');
});
