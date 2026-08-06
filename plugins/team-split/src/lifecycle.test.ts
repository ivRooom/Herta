import { describe, expect, it, vi } from 'vitest';
import {
  expireTeamSplitSession,
  isTeamSplitPluginEnabled,
  type TeamSplitPrismaClient,
  type TeamSplitSessionRecord,
  type TeamSplitTransactionClient,
} from './service.js';

const now = new Date('2026-07-29T04:00:00.000Z');

function createExpiredCandidate(): TeamSplitSessionRecord {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    guildId: 'guild-1',
    creatorId: 'user-1',
    channelId: '123456789012345678',
    messageId: 'message-1',
    title: '期限切れテスト',
    teamCount: 2,
    mode: 'random',
    maxParticipants: 8,
    participantCount: 2,
    participants: ['user-1', 'user-2'],
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
    createdAt: new Date('2026-07-29T02:00:00.000Z'),
    updatedAt: new Date('2026-07-29T02:00:00.000Z'),
  };
}

function createLifecyclePrisma(enabled: boolean): {
  prisma: TeamSplitPrismaClient;
  getSession: () => TeamSplitSessionRecord;
  audit: ReturnType<typeof vi.fn>;
} {
  let session = createExpiredCandidate();
  const audit = vi.fn(async () => ({}));
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
      create: vi.fn(async () => session),
      update: vi.fn(async (args: Record<string, unknown>) => {
        const data = (args.data ?? {}) as Record<string, unknown>;
        const version = data.version as { increment?: number } | undefined;
        session = {
          ...session,
          ...data,
          version: version ? session.version + (version.increment ?? 0) : session.version,
          updatedAt: now,
        } as TeamSplitSessionRecord;
        return session;
      }),
    },
    teamSplitParticipant: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => {
        throw new Error('not used');
      }),
      update: vi.fn(async () => {
        throw new Error('not used');
      }),
    },
    auditLog: { create: audit },
    guildPlugin: { findUnique: vi.fn(async () => ({ enabled })) },
    $queryRawUnsafe: vi.fn(async () => undefined),
  } as unknown as TeamSplitTransactionClient;

  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as TeamSplitPrismaClient;

  return { prisma, getSession: () => session, audit };
}

describe('Team Split lifecycle', () => {
  it('期限を過ぎたopenセッションをexpiredへ変更する', async () => {
    const state = createLifecyclePrisma(true);
    const result = await expireTeamSplitSession(state.prisma, {
      guildId: 'guild-1',
      sessionId: state.getSession().id,
      now,
    });

    expect(result).toMatchObject({
      status: 'expired',
      closedAt: now,
      messageState: 'pending',
      version: 2,
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'system',
          event: 'team_split.expire',
        }),
      }),
    );
  });

  it('Plugin無効Guildを無効として返す', async () => {
    const state = createLifecyclePrisma(false);
    await expect(isTeamSplitPluginEnabled(state.prisma, 'guild-1')).resolves.toBe(false);
  });
});
