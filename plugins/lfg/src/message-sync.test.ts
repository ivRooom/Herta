import { describe, expect, it, vi } from 'vitest';
import {
  markLfgMessageSynchronized,
  updateLfgMessageReference,
  type LfgPostRecord,
  type LfgPrismaClient,
  type LfgTransactionClient,
} from './service.js';

function post(version = 3): LfgPostRecord {
  const now = new Date('2026-07-29T00:00:00.000Z');
  return {
    id: 'post-1',
    guildId: 'guild-1',
    creatorId: 'user-1',
    channelId: '123456789012345678',
    messageId: '223456789012345678',
    game: 'Minecraft',
    title: '募集',
    description: '',
    maxPlayers: 4,
    participantCount: 2,
    startTime: null,
    expiresAt: new Date('2026-07-29T03:00:00.000Z'),
    status: 'open',
    messageState: 'pending',
    lastErrorName: null,
    closedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-2',
    deletedAt: null,
    version,
    createdAt: now,
    updatedAt: now,
  };
}

function createPrisma(current: LfgPostRecord) {
  const update = vi.fn(async (args: Record<string, unknown>) => ({
    ...current,
    ...((args.data ?? {}) as Partial<LfgPostRecord>),
  }));
  const tx = {
    lfgPost: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(async () => current),
      create: vi.fn(),
      update,
    },
    lfgParticipant: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    guildPlugin: { findUnique: vi.fn() },
    $queryRawUnsafe: vi.fn(async () => undefined),
  } as unknown as LfgTransactionClient;
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as LfgPrismaClient;
  return { prisma, update };
}

describe('LFG message version synchronization', () => {
  it('同じversionのDiscord表示だけactiveへ確定する', async () => {
    const state = createPrisma(post(3));
    await markLfgMessageSynchronized(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      expectedVersion: 3,
    });
    expect(state.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { messageState: 'active', lastErrorName: null },
    });
  });

  it('新しいjoinでversionが進んだ場合は古い同期結果をactiveにしない', async () => {
    const state = createPrisma(post(4));
    const result = await markLfgMessageSynchronized(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      expectedVersion: 3,
    });
    expect(result?.version).toBe(4);
    expect(state.update).not.toHaveBeenCalled();
  });

  it('メッセージ参照登録もversion不一致時は上書きしない', async () => {
    const state = createPrisma(post(5));
    await updateLfgMessageReference(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      messageId: '999999999999999999',
      actorId: 'system',
      expectedVersion: 4,
    });
    expect(state.update).not.toHaveBeenCalled();
  });
});
