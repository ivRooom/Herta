import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import {
  listMemberActivityEvents,
  recordMemberActivityEvent,
  scrubExpiredMemberActivityContent,
} from './activity-log-repository.js';

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    memberActivityEvent: {
      create: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  } as unknown as PrismaClient;
}

describe('recordMemberActivityEvent', () => {
  it('必須フィールドとoptionalフィールドの既定値でcreateする', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const prisma = mockPrisma({ create });

    await recordMemberActivityEvent(prisma, {
      guildId: 'guild-1',
      userId: 'user-1',
      event: 'message_delete',
      channelId: 'channel-1',
      messageId: 'message-1',
      content: '削除された本文',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-1',
        event: 'message_delete',
        channelId: 'channel-1',
        messageId: 'message-1',
        content: '削除された本文',
      }),
    });
  });

  it('userId/content/metadataを省略した場合はnullまたはundefinedになる', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const prisma = mockPrisma({ create });

    await recordMemberActivityEvent(prisma, {
      guildId: 'guild-1',
      userId: null,
      event: 'emoji_create',
    });

    const data = create.mock.calls[0]![0].data;
    expect(data.userId).toBeNull();
    expect(data.channelId).toBeNull();
    expect(data.messageId).toBeNull();
    expect(data.content).toBeNull();
    expect(data.metadata).toBeUndefined();
  });
});

describe('scrubExpiredMemberActivityContent', () => {
  it('occurredAtが保持期間より古くcontentが残っているレコードだけをnull化する', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = mockPrisma({ updateMany });

    const result = await scrubExpiredMemberActivityContent(prisma, 180);

    expect(result).toBe(3);
    const call = updateMany.mock.calls[0]![0];
    expect(call.where.content).toEqual({ not: null });
    expect(call.data.content).toBeNull();
    expect(call.data.contentScrubbedAt).toBeInstanceOf(Date);
    expect(call.where.occurredAt.lt).toBeInstanceOf(Date);
  });
});

describe('listMemberActivityEvents', () => {
  it('limitを1〜25へ丸め、guildId/userId/eventで絞り込む', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = mockPrisma({ findMany });

    await listMemberActivityEvents(prisma, {
      guildId: 'guild-1',
      userId: 'user-1',
      event: 'voice_join',
      limit: 999,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-1', userId: 'user-1', event: 'voice_join' },
      orderBy: { occurredAt: 'desc' },
      take: 25,
    });
  });

  it('userId/eventを省略した場合はwhereに含めない', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = mockPrisma({ findMany });

    await listMemberActivityEvents(prisma, { guildId: 'guild-1', limit: 0 });

    const call = findMany.mock.calls[0]![0];
    expect(call.where).toEqual({ guildId: 'guild-1' });
    expect(call.take).toBe(1);
  });

  it('DBの行を期待する形へマップする', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'row-1',
        userId: 'user-1',
        event: 'message_update',
        channelId: 'channel-1',
        messageId: 'message-1',
        content: '編集前の本文',
        contentScrubbedAt: null,
        metadata: { foo: 'bar' },
        occurredAt,
      },
    ]);
    const prisma = mockPrisma({ findMany });

    const rows = await listMemberActivityEvents(prisma, { guildId: 'guild-1', limit: 10 });

    expect(rows).toEqual([
      {
        id: 'row-1',
        userId: 'user-1',
        event: 'message_update',
        channelId: 'channel-1',
        messageId: 'message-1',
        content: '編集前の本文',
        contentScrubbedAt: null,
        metadata: { foo: 'bar' },
        occurredAt,
      },
    ]);
  });
});
