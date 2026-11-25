import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@herta/db';
import { buildTicketMessagePayload, buildTicketThreadPayload } from './tickets-core.js';
import {
  enqueueTicketPayloads,
  findTicketThreadLinkByThreadId,
  listDueTicketOutboxRows,
  markTicketOutboxRetry,
  saveTicketThreadLink,
  setTicketThreadClaimedBy,
} from './tickets-outbox-repository.js';

interface OutboxRow {
  id: string;
  sourceEventId: string;
  eventId: string;
  guildId: string;
  kind: string;
  ticketId: string;
  body: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatus: number | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

interface LinkRow {
  ticketId: string;
  guildId: string;
  channelId: string;
  threadId: string;
  requesterId: string;
  claimedById: string | null;
}

/** skipDuplicates の一意制約だけを再現した最小の fake Prisma。 */
function createFakePrisma() {
  const outbox: OutboxRow[] = [];
  const links = new Map<string, LinkRow>();
  let sequence = 0;
  const prisma = {
    ticketEventOutbox: {
      async createMany({
        data,
        skipDuplicates,
      }: {
        data: Array<
          Omit<
            OutboxRow,
            | 'id'
            | 'status'
            | 'attempts'
            | 'nextAttemptAt'
            | 'lastStatus'
            | 'lastError'
            | 'sentAt'
            | 'createdAt'
          >
        >;
        skipDuplicates?: boolean;
      }) {
        let count = 0;
        for (const row of data) {
          if (
            skipDuplicates &&
            outbox.some((existing) => existing.sourceEventId === row.sourceEventId)
          ) {
            continue;
          }
          sequence += 1;
          outbox.push({
            ...row,
            id: `row-${sequence}`,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: null,
            lastStatus: null,
            lastError: null,
            sentAt: null,
            createdAt: new Date(sequence * 1000),
          });
          count += 1;
        }
        return { count };
      },
      async findMany({
        where,
        take,
      }: {
        where: {
          guildId: string;
          status: string;
          OR: Array<{ nextAttemptAt: null } | { nextAttemptAt: { lte: Date } }>;
        };
        take: number;
      }) {
        const now = (where.OR[1] as { nextAttemptAt: { lte: Date } }).nextAttemptAt.lte;
        return outbox
          .filter(
            (row) =>
              row.guildId === where.guildId &&
              row.status === where.status &&
              (row.nextAttemptAt === null || row.nextAttemptAt <= now),
          )
          .slice(0, take);
      },
      async update({ where, data }: { where: { id: string }; data: Partial<OutboxRow> }) {
        const row = outbox.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
    ticketThreadLink: {
      async upsert({
        where,
        create,
        update,
      }: {
        where: { ticketId: string };
        create: Omit<LinkRow, 'claimedById'> & { claimedById?: string | null };
        update: Partial<LinkRow>;
      }) {
        const existing = links.get(where.ticketId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: LinkRow = { ...create, claimedById: create.claimedById ?? null };
        links.set(where.ticketId, row);
        return row;
      },
      async findFirst({ where }: { where: { guildId: string; threadId: string } }) {
        return (
          [...links.values()].find(
            (row) => row.guildId === where.guildId && row.threadId === where.threadId,
          ) ?? null
        );
      },
      async update({ where, data }: { where: { ticketId: string }; data: Partial<LinkRow> }) {
        const row = links.get(where.ticketId);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, outbox, links };
}

const messagePayload = buildTicketMessagePayload({
  ticketId: 'TK-0123456789AB',
  authorDiscordUserId: '222222222222222222',
  discordMessageId: '555555555555555555',
  body: '返信です',
});

describe('enqueueTicketPayloads', () => {
  it('同じ Discord メッセージは sourceEventId で冪等に弾かれる', async () => {
    const { prisma, outbox } = createFakePrisma();
    await expect(enqueueTicketPayloads(prisma, 'guild-1', [messagePayload])).resolves.toBe(1);
    await expect(enqueueTicketPayloads(prisma, 'guild-1', [messagePayload])).resolves.toBe(0);
    expect(outbox).toHaveLength(1);
  });

  it('thread 紐付けも冪等', async () => {
    const { prisma, outbox } = createFakePrisma();
    const payload = buildTicketThreadPayload({
      ticketId: 'TK-0123456789AB',
      discordChannelId: '333333333333333333',
      discordThreadId: '444444444444444444',
    });
    await enqueueTicketPayloads(prisma, 'guild-1', [payload]);
    await enqueueTicketPayloads(prisma, 'guild-1', [payload]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.kind).toBe('thread');
  });
});

describe('listDueTicketOutboxRows / markTicketOutboxRetry', () => {
  it('再送時刻が来ていない行は対象外で、上限回数で failed になる', async () => {
    const { prisma, outbox } = createFakePrisma();
    await enqueueTicketPayloads(prisma, 'guild-1', [messagePayload]);
    const now = new Date('2026-11-25T00:00:00.000Z');
    const due = await listDueTicketOutboxRows(prisma, 'guild-1', now);
    expect(due).toHaveLength(1);

    const failed = await markTicketOutboxRetry(
      prisma,
      { id: due[0]!.id, attempts: 11 },
      { status: 500 },
      now,
    );
    expect(failed).toBe(true);
    expect(outbox[0]?.status).toBe('failed');
    await expect(listDueTicketOutboxRows(prisma, 'guild-1', now)).resolves.toHaveLength(0);
  });

  it('Guild が違う行は配送対象にしない', async () => {
    const { prisma } = createFakePrisma();
    await enqueueTicketPayloads(prisma, 'guild-1', [messagePayload]);
    await expect(
      listDueTicketOutboxRows(prisma, 'guild-2', new Date('2026-11-25T00:00:00.000Z')),
    ).resolves.toHaveLength(0);
  });
});

describe('TicketThreadLink', () => {
  it('保存・逆引き・Claim 記録ができる', async () => {
    const { prisma } = createFakePrisma();
    await saveTicketThreadLink(prisma, {
      ticketId: 'TK-0123456789AB',
      guildId: 'guild-1',
      channelId: '333333333333333333',
      threadId: '444444444444444444',
      requesterId: '222222222222222222',
    });
    const found = await findTicketThreadLinkByThreadId(prisma, 'guild-1', '444444444444444444');
    expect(found?.ticketId).toBe('TK-0123456789AB');
    await expect(
      findTicketThreadLinkByThreadId(prisma, 'guild-1', '999999999999999999'),
    ).resolves.toBeNull();

    const claimed = await setTicketThreadClaimedBy(
      prisma,
      'guild-1',
      '444444444444444444',
      '777777777777777777',
    );
    expect(claimed?.claimedById).toBe('777777777777777777');
  });
});
