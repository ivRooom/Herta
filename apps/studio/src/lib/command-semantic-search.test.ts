import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FixedWindowRateLimiter,
  scoreStudioCommandsWithOpenAI,
  StudioSemanticProviderError,
} from './command-semantic-provider.ts';
import {
  buildStudioCommandSemanticDocuments,
  mergeStudioCommandSearchResults,
  parseStudioCommandSemanticRequest,
  parseStudioCommandSemanticResponse,
  STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD,
} from './command-semantic-search.ts';
import {
  buildStudioCommandItems,
  filterStudioCommandItems,
  STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH,
  STUDIO_COMMAND_SEARCH_RESULT_LIMIT,
} from './studio-navigation.ts';

const GUILD_ID = '123456789012345678';

test('semantic requestはqueryと有効なGuild IDだけを受け付ける', () => {
  assert.deepEqual(
    parseStudioCommandSemanticRequest({ query: '  予約投稿したい  ', guildId: GUILD_ID }),
    {
      query: '予約投稿したい',
      guildId: GUILD_ID,
    },
  );
  assert.deepEqual(parseStudioCommandSemanticRequest({ query: '稼働状況', guildId: null }), {
    query: '稼働状況',
    guildId: null,
  });
  assert.equal(parseStudioCommandSemanticRequest({ query: 'a', guildId: null }), null);
  assert.equal(
    parseStudioCommandSemanticRequest({ query: '予約投稿', guildId: 'not-a-guild' }),
    null,
  );
  assert.equal(parseStudioCommandSemanticRequest({ query: 123, guildId: null }), null);
});

test('semantic requestのqueryは正規化前に100文字へ制限する', () => {
  const parsed = parseStudioCommandSemanticRequest({
    query: 'x'.repeat(STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH + 50),
    guildId: null,
  });

  assert.ok(parsed);
  assert.equal(parsed.query.length, STUDIO_COMMAND_SEARCH_QUERY_MAX_LENGTH);
});

test('semantic corpusはGuild名と実Guild IDをproviderへ送らない', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Private Guild Name');
  const documents = buildStudioCommandSemanticDocuments(commands);
  const guildDocument = documents.find((document) => document.id === 'guild-daily-content');

  assert.ok(guildDocument);
  assert.equal(guildDocument.text.includes('Private Guild Name'), false);
  assert.equal(guildDocument.text.includes(GUILD_ID), false);
  assert.ok(guildDocument.text.includes('/dashboard/guilds/{guildId}/daily-content'));
  assert.ok(guildDocument.text.includes('Botで予約投稿したい'));
});

test('lexical結果をsemantic-only候補より常に優先する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const lexical = filterStudioCommandItems(commands, 'moderation');
  const semanticScores = [
    { id: 'guild-daily-content', score: 1 },
    { id: 'guild-lfg', score: 0.99 },
  ];
  const merged = mergeStudioCommandSearchResults(commands, lexical, semanticScores);

  assert.deepEqual(
    merged.slice(0, lexical.length).map((command) => command.id),
    lexical.map((command) => command.id),
  );
  assert.ok(merged.findIndex((command) => command.id === 'guild-daily-content') >= lexical.length);
});

test('semantic threshold未満・未知ID・不正scoreを検索結果へ追加しない', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const lexical = filterStudioCommandItems(commands, 'semantic only query');
  const merged = mergeStudioCommandSearchResults(commands, lexical, [
    { id: 'guild-lfg', score: STUDIO_COMMAND_SEMANTIC_SCORE_THRESHOLD - 0.01 },
    { id: 'missing-command', score: 1 },
    { id: 'guild-daily-content', score: Number.NaN },
  ]);

  assert.deepEqual(merged, lexical);
});

test('semantic mergeも検索結果を20件へ制限する', () => {
  const commands = buildStudioCommandItems(GUILD_ID, 'Test Guild');
  const semanticScores = commands.map((command) => ({ id: command.id, score: 1 }));
  const merged = mergeStudioCommandSearchResults(commands, [], semanticScores);

  assert.equal(merged.length, STUDIO_COMMAND_SEARCH_RESULT_LIMIT);
});

test('semantic responseはmodeと0..1の有限scoreだけを受け付ける', () => {
  assert.deepEqual(
    parseStudioCommandSemanticResponse({
      mode: 'semantic',
      scores: [
        { id: 'guild-lfg', score: 0.9 },
        { id: 'bad-high', score: 2 },
        { id: 'bad-type', score: '0.8' },
      ],
    }),
    { mode: 'semantic', scores: [{ id: 'guild-lfg', score: 0.9 }] },
  );
  assert.deepEqual(
    parseStudioCommandSemanticResponse({
      mode: 'fallback',
      scores: [{ id: 'guild-lfg', score: 1 }],
    }),
    { mode: 'fallback', scores: [] },
  );
  assert.deepEqual(parseStudioCommandSemanticResponse(null), { mode: 'fallback', scores: [] });
});

test('OpenAI embeddingsのcosine similarityをcommand scoreへ変換する', async () => {
  const scores = await scoreStudioCommandsWithOpenAI({
    apiKey: 'test-key',
    query: '予約投稿',
    documents: [
      { id: 'same', text: '予約投稿を作る' },
      { id: 'different', text: '監査ログを見る' },
    ],
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key');
      return new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [1, 0] },
            { index: 1, embedding: [1, 0] },
            { index: 2, embedding: [0, 1] },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  assert.equal(scores[0]?.id, 'same');
  assert.equal(scores[0]?.score, 1);
  assert.equal(scores[1]?.id, 'different');
  assert.equal(scores[1]?.score, 0);
});

test('provider non-2xxとmalformed responseを明示的に失敗扱いする', async () => {
  await assert.rejects(
    scoreStudioCommandsWithOpenAI({
      apiKey: 'test-key',
      query: 'test',
      documents: [{ id: 'one', text: 'one' }],
      fetchImpl: async () => new Response('{}', { status: 503 }),
    }),
    (error: unknown) => error instanceof StudioSemanticProviderError && error.code === 'non_2xx',
  );

  await assert.rejects(
    scoreStudioCommandsWithOpenAI({
      apiKey: 'test-key',
      query: 'test',
      documents: [{ id: 'one', text: 'one' }],
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 }),
    }),
    (error: unknown) =>
      error instanceof StudioSemanticProviderError && error.code === 'malformed_response',
  );
});

test('provider network failureをfallback可能な明示エラーへ変換する', async () => {
  await assert.rejects(
    scoreStudioCommandsWithOpenAI({
      apiKey: 'test-key',
      query: 'test',
      documents: [{ id: 'one', text: 'one' }],
      fetchImpl: async () => {
        throw new Error('network unavailable');
      },
    }),
    (error: unknown) => error instanceof StudioSemanticProviderError && error.code === 'network',
  );
});

test('provider timeoutを固定時間で中断する', async () => {
  await assert.rejects(
    scoreStudioCommandsWithOpenAI({
      apiKey: 'test-key',
      query: 'test',
      documents: [{ id: 'one', text: 'one' }],
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    }),
    (error: unknown) => error instanceof StudioSemanticProviderError && error.code === 'timeout',
  );
});

test('semantic rate limitはwindow内の上限を強制し、期限後に回復する', () => {
  const limiter = new FixedWindowRateLimiter(2, 1000, 10);

  assert.equal(limiter.consume('user', 1000).allowed, true);
  assert.equal(limiter.consume('user', 1100).allowed, true);
  const denied = limiter.consume('user', 1200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 800);
  assert.equal(limiter.consume('user', 2000).allowed, true);
});
