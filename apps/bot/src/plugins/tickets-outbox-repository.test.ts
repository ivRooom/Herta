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

interface FakeOutboxOptions {
  /** 既に outbox に存在する sourceEventId の集合 (再観測の再現用)。 */
  existingSourceEventIds?: ReadonlySet<string>;
  failCreate?: boolean;
}

function createFakePrisma(options: FakeOutboxOptions = {}) {
  const created: Array<{ kind: string; sourceEventId: string }> = [];
  const createMany = vi.fn(
    async (arg: { data: Array<{ kind: string; sourceEventId: string }> }) => {
      if (options.failCreate) throw new Error('db down');
      let count = 0;
      for (const row of arg.data) {
        // skipDuplicates 相当: 既存の sourceEventId は数えない。
        if (options.existingSourceEventIds?.has(row.sourceEventId)) continue;
        created.push(row);
        count += 1;
      }
      return { count };
    },
  );
  const findUnique = vi.fn(async (arg: { where: { sourceEventId: string } }) =>
    options.existingSourceEventIds?.has(arg.where.sourceEventId) ? { id: 'existing-row' } : null,
  );
  const tx = { ticketEventOutbox: { createMany, findUnique } };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<number>) =>
    callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { prisma, createMany, findUnique, transaction, created };
}

describe('enqueueTicketPayloads', () => {
  it('関連 payload 群 (本文＋添付) を1回のトランザクションで原子的に積む', async () => {
    const fake = createFakePrisma();

    const count = await enqueueTicketPayloads(fake.prisma, 'guild-1', [
      payload('ticket-msg:1', 'message'),
      payload('ticket-attach:1:700000000000000001', 'attachment'),
    ]);

    expect(count).toBe(2);
    // 分割した複数回の書き込みではなく、単一トランザクション・単一 createMany。
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(fake.createMany).toHaveBeenCalledTimes(1);
    const firstCall = fake.createMany.mock.calls[0];
    expect(firstCall?.[0].data.map((row) => row.kind)).toEqual(['message', 'attachment']);
  });

  it('書き込みが失敗したら全体が失敗し、部分状態を残さない', async () => {
    const fake = createFakePrisma({ failCreate: true });

    await expect(
      enqueueTicketPayloads(fake.prisma, 'guild-1', [
        payload('ticket-msg:1', 'message'),
        payload('ticket-attach:1:700000000000000001', 'attachment'),
      ]),
    ).rejects.toThrow('db down');
  });

  it('空の payload 群では何も書かない', async () => {
    const fake = createFakePrisma();

    await expect(enqueueTicketPayloads(fake.prisma, 'guild-1', [])).resolves.toBe(0);
    expect(fake.transaction).not.toHaveBeenCalled();
    expect(fake.createMany).not.toHaveBeenCalled();
  });

  it('本文が既に存在する再観測では、バッチ一式を no-op にして添付だけを追加しない', async () => {
    // 初回観測で「転送されませんでした」注記付き本文が確定した後に、
    // 再観測でダウンロードが成功しても、本文の注記と矛盾する添付行を
    // 後から足さない (再生ポリシーはバッチ単位で一貫させる)。
    const fake = createFakePrisma({
      existingSourceEventIds: new Set(['ticket-msg:1']),
    });

    const count = await enqueueTicketPayloads(fake.prisma, 'guild-1', [
      payload('ticket-msg:1', 'message'),
      payload('ticket-attach:1:700000000000000001', 'attachment'),
    ]);

    expect(count).toBe(0);
    expect(fake.findUnique).toHaveBeenCalledWith({
      where: { sourceEventId: 'ticket-msg:1' },
      select: { id: true },
    });
    expect(fake.createMany).not.toHaveBeenCalled();
    expect(fake.created).toEqual([]);
  });

  it('本文を含まないバッチ (スレッド紐付け) は存在確認をせず従来どおり積む', async () => {
    const fake = createFakePrisma();

    const count = await enqueueTicketPayloads(fake.prisma, 'guild-1', [
      payload('ticket-thread:TK-0123456789AB:444', 'thread'),
    ]);

    expect(count).toBe(1);
    expect(fake.findUnique).not.toHaveBeenCalled();
    expect(fake.createMany).toHaveBeenCalledTimes(1);
  });
});
