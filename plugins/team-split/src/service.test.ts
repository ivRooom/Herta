import { describe, expect, it, vi } from 'vitest';
import {
  joinTeamSplitSession,
  leaveTeamSplitSession,
  markTeamSplitMessageSynchronized,
  rerollTeamSplitSession,
  splitTeamSplitSession,
  type TeamSplitParticipantRecord,
  type TeamSplitPrismaClient,
  type TeamSplitSessionRecord,
  type TeamSplitTransactionClient,
} from './service.js';

const now = new Date('2026-07-29T00:00:00.000Z');

function createSession(overrides: Partial<TeamSplitSessionRecord> = {}): TeamSplitSessionRecord {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    guildId: 'guild-1',
    creatorId: 'user-1',
    channelId: '123456789012345678',
    messageId: 'message-1',
    title: 'チーム分け',
    teamCount: 2,
    mode: 'random',
    maxParticipants: 4,
    participantCount: 1,
    participants: ['user-1'],
    teams: null,
    seedHash: 'a'.repeat(64),
    generation: 0,
    status: 'open',
    expiresAt: new Date('2026-07-29T03:00:00.000Z'),
    splitAt: null,
    closedAt: null,
    messageState: 'active',
    lastErrorName: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createInMemoryPrisma(initialSession = createSession()): {
  prisma: TeamSplitPrismaClient;
  getSession: () => TeamSplitSessionRecord;
  participants: TeamSplitParticipantRecord[];
  lock: ReturnType<typeof vi.fn>;
} {
  let session = initialSession;
  const participants: TeamSplitParticipantRecord[] = [
    {
      sessionId: session.id,
      guildId: session.guildId,
      userId: session.creatorId,
      score: 10,
      status: 'joined',
      joinedAt: now,
      leftAt: null,
      updatedAt: now,
    },
  ];
  const lock = vi.fn(async () => undefined);

  const matches = (participant: TeamSplitParticipantRecord, where: Record<string, unknown>) =>
    (!where.sessionId || participant.sessionId === where.sessionId) &&
    (!where.guildId || participant.guildId === where.guildId) &&
    (!where.userId || participant.userId === where.userId) &&
    (!where.status || participant.status === where.status);

  const tx = {
    teamSplitSession: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [session]),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        if (where.id && where.id !== session.id) return null;
        if (where.guildId && where.guildId !== session.guildId) return null;
        return session;
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        session = { ...session, ...((args.data ?? {}) as Partial<TeamSplitSessionRecord>) };
        return session;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        const data = (args.data ?? {}) as Record<string, unknown>;
        const version = data.version as { increment?: number } | number | undefined;
        session = {
          ...session,
          ...data,
          version:
            typeof version === 'object'
              ? session.version + (version.increment ?? 0)
              : typeof version === 'number'
                ? version
                : session.version,
          updatedAt: now,
        } as TeamSplitSessionRecord;
        return session;
      }),
    },
    teamSplitParticipant: {
      count: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        return participants.filter((participant) => matches(participant, where)).length;
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        return participants.filter((participant) => matches(participant, where));
      }),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        return participants.find((participant) => matches(participant, where)) ?? null;
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        const data = (args.data ?? {}) as Omit<TeamSplitParticipantRecord, 'updatedAt'>;
        const created = { ...data, updatedAt: now } as TeamSplitParticipantRecord;
        participants.push(created);
        return created;
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as {
          sessionId_userId?: { sessionId: string; userId: string };
        };
        const index = participants.findIndex(
          (participant) =>
            participant.sessionId === where.sessionId_userId?.sessionId &&
            participant.userId === where.sessionId_userId?.userId,
        );
        participants[index] = {
          ...participants[index]!,
          ...((args.data ?? {}) as Partial<TeamSplitParticipantRecord>),
          updatedAt: now,
        };
        return participants[index]!;
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    guildPlugin: { findUnique: vi.fn(async () => ({ enabled: true })) },
    $queryRawUnsafe: lock,
  } as unknown as TeamSplitTransactionClient;

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as TeamSplitPrismaClient;

  return { prisma, getSession: () => session, participants, lock };
}

async function joinSecondMember(state: ReturnType<typeof createInMemoryPrisma>): Promise<void> {
  await joinTeamSplitSession(state.prisma, {
    guildId: 'guild-1',
    sessionId: state.getSession().id,
    userId: 'user-2',
    score: 5,
    now,
  });
}

describe('Team Split join / leave transaction', () => {
  it('参加者追加をSession lockと同じTransaction内で反映する', async () => {
    const state = createInMemoryPrisma();
    const result = await joinTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      userId: 'user-2',
      score: 5,
      now,
    });

    expect(result.state).toBe('joined');
    expect(state.getSession()).toMatchObject({
      participantCount: 2,
      participants: ['user-1', 'user-2'],
      messageState: 'pending',
      version: 2,
    });
    expect(state.lock).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      `team-split:session:guild-1:${state.getSession().id}`,
    );
  });

  it('同一scoreでの二重参加を作成しない', async () => {
    const state = createInMemoryPrisma();
    await joinSecondMember(state);
    const second = await joinTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      userId: 'user-2',
      score: 5,
      now,
    });

    expect(second.state).toBe('already_joined');
    expect(state.participants.filter((participant) => participant.userId === 'user-2')).toHaveLength(1);
  });

  it('定員到達後の参加を拒否する', async () => {
    const state = createInMemoryPrisma(createSession({ maxParticipants: 2 }));
    await joinSecondMember(state);
    const result = await joinTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      userId: 'user-3',
      score: 0,
      now,
    });

    expect(result.state).toBe('full');
    expect(state.participants.some((participant) => participant.userId === 'user-3')).toBe(false);
  });

  it('作成者の辞退を拒否する', async () => {
    const state = createInMemoryPrisma();
    const result = await leaveTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      userId: 'user-1',
      now,
    });
    expect(result.state).toBe('creator_must_close');
  });

  it('別Guildから同じSession IDを操作できない', async () => {
    const state = createInMemoryPrisma();
    const result = await joinTeamSplitSession(state.prisma, {
      guildId: 'guild-2',
      sessionId: state.getSession().id,
      userId: 'user-2',
      score: 0,
      now,
    });
    expect(result.state).toBe('not_found');
  });
});

describe('Team Split split / reroll', () => {
  it('参加者数がteamCount以上なら分割して結果を保存する', async () => {
    const state = createInMemoryPrisma();
    await joinSecondMember(state);
    const result = await splitTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      actorId: 'user-1',
      now,
    });

    expect(result.state).toBe('updated');
    expect(state.getSession()).toMatchObject({ status: 'split', generation: 0 });
    expect(Array.isArray(state.getSession().teams)).toBe(true);
  });

  it('rerollでgenerationを増やす', async () => {
    const state = createInMemoryPrisma();
    await joinSecondMember(state);
    await splitTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      actorId: 'user-1',
      now,
    });
    const firstTeams = state.getSession().teams;
    const result = await rerollTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      actorId: 'user-1',
      now,
    });

    expect(result.state).toBe('updated');
    expect(state.getSession().generation).toBe(1);
    expect(state.getSession().teams).not.toEqual(firstTeams);
  });
});

describe('Team Split message version', () => {
  it('stale versionでは同期完了にしない', async () => {
    const state = createInMemoryPrisma(createSession({ version: 3, messageState: 'pending' }));
    const result = await markTeamSplitMessageSynchronized(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      expectedVersion: 2,
    });
    expect(result?.messageState).toBe('pending');
  });

  it('一致versionだけactiveへ確定する', async () => {
    const state = createInMemoryPrisma(createSession({ version: 3, messageState: 'pending' }));
    const result = await markTeamSplitMessageSynchronized(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      expectedVersion: 3,
    });
    expect(result?.messageState).toBe('active');
  });
});
