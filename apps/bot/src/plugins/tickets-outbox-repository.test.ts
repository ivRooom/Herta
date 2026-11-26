import type { PrismaClient } from '@herta/db';
import { describe, expect, it, vi } from 'vitest';
import type { TicketOutboxPayload } from './tickets-core.js';
import { enqueueTicketPayloads } from './tickets-outbox-repository.js';

function payload(sourceEventId: string, kind: TicketOutboxPayload['kind']): TicketOutboxPayload {
  return {
    sourceEventId,
    eventId: `event-${sourceEventId}`,
    kind,
    ticketId: 'TK-0123456789AB',
    body: '{}',
  };
}

describe('enqueueTicketPayloads', () => {
  it('関連 payload 群 (本文＋添付) を1回のトランザクションで原子的に積む', async () => {
    const createMany = vi.fn(
      async (arg: { data: Array<{ kind: string; sourceEventId: string }> }) => ({
        count: arg.data.length,
      }),
    );
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    const prisma = {
      ticketEventOutbox: { createMany },
      $transaction: transaction,
    } as unknown as PrismaClient;

    const count = await enqueueTicketPayloads(prisma, 'guild-1', [
      payload('ticket-msg:1', 'message'),
      payload('ticket-attach:1:700000000000000001', 'attachment'),
    ]);

    expect(count).toBe(2);
    // 分割した複数回の書き込みではなく、単一トランザクション・単一 createMany。
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    const firstCall = createMany.mock.calls[0];
    expect(firstCall?.[0].data.map((row) => row.kind)).toEqual(['message', 'attachment']);
  });

  it('書き込みが失敗したら全体が失敗し、部分状態を残さない', async () => {
    const createMany = vi.fn(async () => {
      throw new Error('db down');
    });
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    const prisma = {
      ticketEventOutbox: { createMany },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(
      enqueueTicketPayloads(prisma, 'guild-1', [
        payload('ticket-msg:1', 'message'),
        payload('ticket-attach:1:700000000000000001', 'attachment'),
      ]),
    ).rejects.toThrow('db down');
  });

  it('空の payload 群では何も書かない', async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    const prisma = {
      ticketEventOutbox: { createMany },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(enqueueTicketPayloads(prisma, 'guild-1', [])).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
