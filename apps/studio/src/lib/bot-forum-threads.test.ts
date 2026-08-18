import assert from 'node:assert/strict';
import test from 'node:test';
import { BotForumThreadsError, getArchivedForumThreads } from './bot-forum-threads.ts';

const guildId = '123456789012345678';
const forumId = '223456789012345678';

function withBotEnv<T>(callback: () => Promise<T>): Promise<T> {
  const previousHealth = process.env['BOT_HEALTH_URL'];
  const previousSecret = process.env['BOT_INTERNAL_API_SECRET'];
  process.env['BOT_HEALTH_URL'] = 'http://bot.internal:3001';
  process.env['BOT_INTERNAL_API_SECRET'] = 'x'.repeat(32);
  return callback().finally(() => {
    if (previousHealth === undefined) delete process.env['BOT_HEALTH_URL'];
    else process.env['BOT_HEALTH_URL'] = previousHealth;
    if (previousSecret === undefined) delete process.env['BOT_INTERNAL_API_SECRET'];
    else process.env['BOT_INTERNAL_API_SECRET'] = previousSecret;
  });
}

test('archived Forum Thread一覧を検証して返す', async () => {
  await withBotEnv(async () => {
    const requests: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(new URL(String(input)));
      return Response.json({
        threads: [
          {
            id: '323456789012345678',
            name: '過去のお知らせ',
            kind: 'thread',
            position: 2,
            parentId: forumId,
            viewable: true,
            readMessageHistory: true,
          },
        ],
        nextBefore: '2026-08-17T12:00:00.000Z',
      });
    };

    const page = await getArchivedForumThreads(
      guildId,
      forumId,
      '2026-08-18T09:00:00+09:00',
      99,
      fetchImpl,
    );
    assert.equal(page.threads[0]?.parentId, forumId);
    assert.equal(page.nextBefore, '2026-08-17T12:00:00.000Z');
    assert.equal(requests[0]?.searchParams.get('limit'), '50');
    assert.equal(requests[0]?.searchParams.get('before'), '2026-08-18T00:00:00.000Z');
  });
});

test('別ForumのThreadをBot応答から受理しない', async () => {
  await withBotEnv(async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        threads: [
          {
            id: '323456789012345678',
            name: '別Forum',
            kind: 'thread',
            position: 2,
            parentId: '923456789012345678',
            viewable: true,
            readMessageHistory: true,
          },
        ],
        nextBefore: null,
      });
    await assert.rejects(
      () => getArchivedForumThreads(guildId, forumId, null, 50, fetchImpl),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'BotForumThreadsError' &&
        error.message.includes('境界検証'),
    );
  });
});

test('不正cursorをBotへ送信せず拒否する', async () => {
  await withBotEnv(async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return Response.json({ threads: [], nextBefore: null });
    };
    await assert.rejects(
      () => getArchivedForumThreads(guildId, forumId, 'not-a-date', 50, fetchImpl),
      /cursor/u,
    );
    assert.equal(called, false);
  });
});

test('Bot内部APIの401をStudio利用者の認証エラーとして公開しない', async () => {
  await withBotEnv(async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: 'unauthorized' }, { status: 401 });
    await assert.rejects(
      () => getArchivedForumThreads(guildId, forumId, null, 50, fetchImpl),
      (error: unknown) =>
        error instanceof BotForumThreadsError &&
        error.status === 502 &&
        error.message === 'Forumの過去投稿を取得できませんでした',
    );
  });
});
