import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { searchMemberActivityEvents } from './member-activity-feed.js';

type FindManyArgs = {
  where: Record<string, unknown>;
  select: Record<string, unknown>;
  skip: number;
  take: number;
};

function fakePrisma(total: number, rows: Array<Record<string, unknown>> = []) {
  const captured: { countWhere?: unknown; findManyArgs?: FindManyArgs } = {};
  const prisma = {
    memberActivityEvent: {
      count: async (args: { where: unknown }) => {
        captured.countWhere = args.where;
        return total;
      },
      findMany: async (args: FindManyArgs) => {
        captured.findManyArgs = args;
        return rows;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, captured };
}

test('event完全一致フィルタで新種別channel_overwrite_*を検索でき、本文はselectしない', async () => {
  const { prisma, captured } = fakePrisma(1, [
    {
      id: 'evt-1',
      userId: '100000000000000001',
      event: 'channel_overwrite_update',
      channelId: '100000000000000002',
      messageId: null,
      metadata: { auditLogEntryId: '100000000000000003' },
      occurredAt: new Date('2026-11-26T09:55:00.000Z'),
    },
  ]);

  const result = await searchMemberActivityEvents(prisma, {
    guildId: '100000000000000009',
    event: 'channel_overwrite_update',
  });

  assert.deepEqual(captured.findManyArgs?.where, {
    guildId: '100000000000000009',
    event: 'channel_overwrite_update',
  });
  assert.equal(captured.findManyArgs?.select.content, undefined);
  assert.equal('content' in (captured.findManyArgs?.select ?? {}), false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.event, 'channel_overwrite_update');
  assert.equal('content' in (result.items[0] ?? {}), false);
  assert.equal(result.items[0]?.occurredAt, '2026-11-26T09:55:00.000Z');
});

test('userId/channelId完全一致と期間(from含む・to排他)がwhereへ反映される', async () => {
  const { prisma, captured } = fakePrisma(0);
  const from = new Date('2026-11-20T00:00:00.000Z');
  const toExclusive = new Date('2026-11-27T00:00:00.000Z');

  await searchMemberActivityEvents(prisma, {
    guildId: '100000000000000009',
    userId: '100000000000000001',
    channelId: '100000000000000002',
    from,
    toExclusive,
  });

  assert.deepEqual(captured.findManyArgs?.where, {
    guildId: '100000000000000009',
    userId: '100000000000000001',
    channelId: '100000000000000002',
    occurredAt: { gte: from, lt: toExclusive },
  });
});

test('pageSizeは上限50へclampされ、pageも総ページ数へclampされる', async () => {
  const { prisma, captured } = fakePrisma(120);

  const result = await searchMemberActivityEvents(prisma, {
    guildId: '100000000000000009',
    page: 99,
    pageSize: 200,
  });

  assert.equal(result.pageSize, 50);
  assert.equal(result.totalPages, 3);
  assert.equal(result.page, 3);
  assert.equal(captured.findManyArgs?.take, 50);
  assert.equal(captured.findManyArgs?.skip, 100);
});

test('フィルタ未指定時はguildIdのみで検索し既定ページングを使う', async () => {
  const { prisma, captured } = fakePrisma(0);

  const result = await searchMemberActivityEvents(prisma, { guildId: '100000000000000009' });

  assert.deepEqual(captured.findManyArgs?.where, { guildId: '100000000000000009' });
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 25);
});
