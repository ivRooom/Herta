import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@herta/db';
import type { ValorantSessionSnapshot } from './valorant-session-repository.js';
import {
  editExpiredValorantDiscordMessage,
  reconcileExpiredValorantMessages,
} from './valorant-expiry-reconcile.js';

const now = new Date('2026-11-04T02:00:00.000Z');
const guildId = '123456789012345678';
const messageId = '234567890123456789';
const channelId = '345678901234567890';
const id = '773fa90e-f77c-477c-9009-ef7adf6d50c8';

function makeSession(status = 'OPEN'): ValorantSessionSnapshot {
  return {
    id,
    guildId,
    messageId,
    channelId,
    creatorId: guildId,
    voiceChannelId: null,
    optedOutUserIds: [],
    mode: 'RANDOM',
    mapId: null,
    maxParticipants: 5,
    expiresAt: new Date(now.getTime() - 1_000),
    status,
    expiryUiSyncedAt: null,
    expiryUiRetryAt: null,
    expiryUiRetryCount: 0,
    participants: [],
    result: null,
    candidates: [],
    rulesVersion: '13.09',
    completedAt: null,
    createdAt: new Date(now.getTime() - 300_000),
    updatedAt: new Date(now.getTime() - 300_000),
  } as ValorantSessionSnapshot;
}

function testPrisma(session: ValorantSessionSnapshot) {
  const findMany = vi.fn().mockResolvedValue([session]);
  const findFirst = vi.fn().mockResolvedValue({
    ...session,
    status: session.status === 'OPEN' ? 'EXPIRED' : session.status,
  });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    valorantPickSession: { findMany, findFirst, updateMany },
  } as unknown as PrismaClient;
  return { prisma, findMany, findFirst, updateMany };
}

describe('VALORANT expired recruitment reconciliation', () => {
  it('expires the DB row before editing the public Embed and persists success', async () => {
    const { prisma, findMany, updateMany } = testPrisma(makeSession());
    const edit = vi.fn().mockResolvedValue('updated');
    const result = await reconcileExpiredValorantMessages(prisma, {
      guildIds: [guildId],
      now,
      edit,
    });
    expect(result).toEqual({ attempted: 1, updated: 1, gone: 0, retried: 0 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', guildId }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(edit.mock.calls[0]![0].status).toBe('EXPIRED');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiryUiSyncedAt: now, expiryUiRetryCount: 0 }),
      }),
    );
    expect(findMany.mock.calls[0]![0].take).toBe(10);
  });

  it('does not overwrite completed history, only marks a completed reroll deadline', async () => {
    const { prisma, updateMany } = testPrisma(makeSession('COMPLETED'));
    const edit = vi.fn().mockResolvedValue('updated');
    await reconcileExpiredValorantMessages(prisma, { guildIds: [guildId], now, edit });
    expect(edit).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]![0].data).not.toHaveProperty('status');
  });

  it('backs off on Discord errors with durable state rather than losing work', async () => {
    const session = makeSession('EXPIRED');
    session.expiryUiRetryCount = 2;
    const { prisma, updateMany } = testPrisma(session);
    const onRetry = vi.fn();
    const edit = vi.fn().mockRejectedValue(new Error('Discord unavailable'));
    const outcome = await reconcileExpiredValorantMessages(prisma, {
      guildIds: [guildId],
      now,
      edit,
      onRetry,
    });
    expect(outcome.retried).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { expiryUiRetryCount: 3, expiryUiRetryAt: new Date(now.getTime() + 240_000) },
      }),
    );
    expect(onRetry).toHaveBeenCalledWith('Error', 3);
  });

  it('skips stale sessions when a reroll moved the message ID', async () => {
    const { prisma, findFirst, updateMany } = testPrisma(makeSession('COMPLETED'));
    findFirst.mockResolvedValue({ ...makeSession('COMPLETED'), messageId: null });
    const edit = vi.fn().mockResolvedValue('updated');
    const result = await reconcileExpiredValorantMessages(prisma, {
      guildIds: [guildId],
      now,
      edit,
    });
    expect(result.attempted).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('ignores foreign Guilds and caps a DB sweep at 20 sessions', async () => {
    const { prisma, findMany } = testPrisma(makeSession());
    await reconcileExpiredValorantMessages(prisma, { guildIds: [], now, edit: vi.fn() });
    expect(findMany).not.toHaveBeenCalled();
    await reconcileExpiredValorantMessages(prisma, {
      guildIds: [guildId, guildId],
      now,
      batchSize: 10_000,
      edit: vi.fn().mockResolvedValue('updated'),
    });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.guildId.in).toEqual([guildId]);
    expect(where.expiryUiSyncedAt).toBeNull();
    expect(where.OR).toHaveLength(2);
    expect(findMany.mock.calls[0]![0].take).toBe(20);
  });

  it('never edits a newer rerolled message while closing the old session', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const client = {
      guilds: {
        cache: new Map([
          [
            guildId,
            {
              channels: {
                fetch: vi.fn().mockResolvedValue({
                  isTextBased: () => true,
                  messages: {
                    fetch: vi.fn().mockResolvedValue({
                      components: [
                        {
                          components: [
                            {
                              customId:
                                'herta:valorant:pick:v1:773fa90e-f77c-477c-9009-ef7adf6d50c9:reroll',
                            },
                          ],
                        },
                      ],
                      edit,
                    }),
                  },
                }),
              },
            },
          ],
        ]),
      },
    } as unknown as Parameters<typeof editExpiredValorantDiscordMessage>[0];
    const outcome = await editExpiredValorantDiscordMessage(client, makeSession('COMPLETED'));
    expect(outcome).toBe('gone');
    expect(edit).not.toHaveBeenCalled();
  });

  it('does not overwrite a message that has already lost its action buttons', async () => {
    const edit = vi.fn();
    const client = {
      guilds: {
        cache: new Map([
          [
            guildId,
            {
              channels: {
                fetch: vi.fn().mockResolvedValue({
                  isTextBased: () => true,
                  messages: {
                    fetch: vi.fn().mockResolvedValue({ components: [], edit }),
                  },
                }),
              },
            },
          ],
        ]),
      },
    } as unknown as Parameters<typeof editExpiredValorantDiscordMessage>[0];
    expect(await editExpiredValorantDiscordMessage(client, makeSession())).toBe('gone');
    expect(edit).not.toHaveBeenCalled();
  });

  it('preserves completed image attachments and edits only reroll components', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const channel = {
      isTextBased: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue({
          edit,
          components: [{ components: [{ customId: `herta:valorant:pick:v1:${id}:reroll` }] }],
        }),
      },
    };
    const client = {
      guilds: {
        cache: new Map([[guildId, { channels: { fetch: vi.fn().mockResolvedValue(channel) } }]]),
      },
    } as unknown as Parameters<typeof editExpiredValorantDiscordMessage>[0];
    const session = makeSession('COMPLETED');
    const outcome = await editExpiredValorantDiscordMessage(client, session);
    expect(outcome).toBe('updated');
    expect(edit.mock.calls[0]![0]).toHaveProperty('components');
    expect(edit.mock.calls[0]![0]).not.toHaveProperty('attachments');
    expect(edit.mock.calls[0]![0]).not.toHaveProperty('embeds');
  });
});
