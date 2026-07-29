import { describe, expect, it, vi } from 'vitest';
import { LFG_DEFAULTS, LfgValidationError } from './config.js';
import {
  createLfgPost,
  joinLfgPost,
  leaveLfgPost,
  type LfgParticipantRecord,
  type LfgPostRecord,
  type LfgPrismaClient,
  type LfgTransactionClient,
} from './service.js';

const now = new Date('2026-07-29T00:00:00.000Z');

function createPost(overrides: Partial<LfgPostRecord> = {}): LfgPostRecord {
  return {
    id: 'post-1',
    guildId: 'guild-1',
    creatorId: 'user-1',
    channelId: '123456789012345678',
    messageId: null,
    game: 'Minecraft',
    title: '建築メンバー募集',
    description: 'サバイバル建築',
    maxPlayers: 2,
    participantCount: 1,
    startTime: null,
    expiresAt: new Date('2026-07-29T03:00:00.000Z'),
    status: 'open',
    messageState: 'pending',
    lastErrorName: null,
    closedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createInMemoryPrisma(initialPost = createPost()): {
  prisma: LfgPrismaClient;
  getPost: () => LfgPostRecord;
  participants: LfgParticipantRecord[];
  lock: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
} {
  let post = initialPost;
  const participants: LfgParticipantRecord[] = [
    {
      lfgId: post.id,
      guildId: post.guildId,
      userId: post.creatorId,
      status: 'joined',
      joinedAt: now,
      leftAt: null,
      updatedAt: now,
    },
  ];
  const lock = vi.fn(async () => undefined);
  const audit = vi.fn(async () => ({}));

  const tx = {
    lfgPost: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [post]),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        if (where.id && where.id !== post.id) return null;
        if (where.guildId && where.guildId !== post.guildId) return null;
        if (where.creatorId && where.creatorId !== post.creatorId) return null;
        return post;
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        post = { ...post, ...((args.data ?? {}) as Partial<LfgPostRecord>) };
        return post;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        const data = (args.data ?? {}) as Record<string, unknown>;
        const version = data.version as { increment?: number } | number | undefined;
        post = {
          ...post,
          ...data,
          version:
            typeof version === 'object'
              ? post.version + (version.increment ?? 0)
              : typeof version === 'number'
                ? version
                : post.version,
        } as LfgPostRecord;
        return post;
      }),
    },
    lfgParticipant: {
      count: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        return participants.filter(
          (participant) =>
            (!where.lfgId || participant.lfgId === where.lfgId) &&
            (!where.guildId || participant.guildId === where.guildId) &&
            (!where.status || participant.status === where.status),
        ).length;
      }),
      findMany: vi.fn(async () => participants),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        return (
          participants.find(
            (participant) =>
              (!where.lfgId || participant.lfgId === where.lfgId) &&
              (!where.guildId || participant.guildId === where.guildId) &&
              (!where.userId || participant.userId === where.userId) &&
              (!where.status || participant.status === where.status),
          ) ?? null
        );
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        const data = (args.data ?? {}) as Omit<LfgParticipantRecord, 'updatedAt'>;
        const created = { ...data, updatedAt: now } as LfgParticipantRecord;
        participants.push(created);
        return created;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as {
          lfgId_userId?: { lfgId: string; userId: string };
        };
        const index = participants.findIndex(
          (participant) =>
            participant.lfgId === where.lfgId_userId?.lfgId &&
            participant.userId === where.lfgId_userId?.userId,
        );
        participants[index] = {
          ...participants[index]!,
          ...((args.data ?? {}) as Partial<LfgParticipantRecord>),
          updatedAt: now,
        };
        return participants[index]!;
      }),
    },
    auditLog: { create: audit },
    guildPlugin: { findUnique: vi.fn(async () => ({ enabled: true })) },
    $queryRawUnsafe: lock,
  } as unknown as LfgTransactionClient;

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as LfgPrismaClient;

  return { prisma, getPost: () => post, participants, lock, audit };
}

describe('LFG join / leave transaction', () => {
  it('参加者追加と定員到達を同じTransaction内で反映する', async () => {
    const state = createInMemoryPrisma();
    const result = await joinLfgPost(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      userId: 'user-2',
      now,
    });

    expect(result.state).toBe('joined');
    expect(state.getPost()).toMatchObject({ participantCount: 2, status: 'full' });
    expect(state.participants.filter((participant) => participant.status === 'joined')).toHaveLength(2);
    expect(state.lock).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      'lfg:post:guild-1:post-1',
    );
  });

  it('同一ユーザーの二重参加を作成しない', async () => {
    const state = createInMemoryPrisma();
    await joinLfgPost(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      userId: 'user-2',
      now,
    });
    const second = await joinLfgPost(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      userId: 'user-2',
      now,
    });

    expect(second.state).toBe('already_joined');
    expect(state.participants.filter((participant) => participant.userId === 'user-2')).toHaveLength(1);
  });

  it('満員後の追加参加を拒否する', async () => {
    const state = createInMemoryPrisma(
      createPost({ status: 'full', participantCount: 2, maxPlayers: 2 }),
    );
    state.participants.push({
      lfgId: 'post-1',
      guildId: 'guild-1',
      userId: 'user-2',
      status: 'joined',
      joinedAt: now,
      leftAt: null,
      updatedAt: now,
    });

    const result = await joinLfgPost(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      userId: 'user-3',
      now,
    });
    expect(result.state).toBe('full');
    expect(state.participants.some((participant) => participant.userId === 'user-3')).toBe(false);
  });

  it('作成者のleaveを拒否しcancelへ誘導する', async () => {
    const state = createInMemoryPrisma();
    const result = await leaveLfgPost(state.prisma, {
      guildId: 'guild-1',
      postId: 'post-1',
      userId: 'user-1',
      now,
    });
    expect(result.state).toBe('creator_must_cancel');
  });

  it('別Guildから同じpost IDを操作できない', async () => {
    const state = createInMemoryPrisma();
    const result = await joinLfgPost(state.prisma, {
      guildId: 'guild-2',
      postId: 'post-1',
      userId: 'user-2',
      now,
    });
    expect(result.state).toBe('not_found');
  });
});

describe('LFG create limits', () => {
  it('作成Cooldown中の募集を拒否する', async () => {
    const state = createInMemoryPrisma();
    const tx = state.prisma as unknown as {
      lfgPost: { findFirst: ReturnType<typeof vi.fn> };
    };
    tx.lfgPost.findFirst.mockResolvedValueOnce(createPost());

    await expect(
      createLfgPost(state.prisma, {
        guildId: 'guild-1',
        creatorId: 'user-1',
        actorId: 'user-1',
        post: {
          channelId: '123456789012345678',
          game: 'Minecraft',
          title: '募集',
          maxPlayers: 4,
        },
        config: LFG_DEFAULTS,
        now,
      }),
    ).rejects.toBeInstanceOf(LfgValidationError);
  });
});
