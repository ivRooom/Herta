import { describe, expect, it, vi } from 'vitest';
import { normalizeDailyContentConfig } from './config.js';
import { retryDailyContentDelivery } from './retry.js';
import {
  createDailyContent,
  recoverStaleDelivery,
  reserveDueDelivery,
  type DailyContentPrismaClient,
  type DailyContentTransactionClient,
} from './service.js';

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    guildId: 'guild-1',
    channelId: '123456789012345678',
    title: '朝のお知らせ',
    content: 'おはようございます',
    scheduleTime: '09:00',
    timezone: 'Asia/Tokyo',
    enabled: true,
    nextRunAt: new Date('2026-07-29T00:00:00.000Z'),
    lastScheduledAt: null,
    lastSentAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  };
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    dailyContentId: 'schedule-1',
    guildId: 'guild-1',
    idempotencyKey: 'schedule-1:2026-07-29T00:00:00.000Z',
    origin: 'scheduled',
    scheduledFor: new Date('2026-07-29T00:00:00.000Z'),
    status: 'pending',
    attemptCount: 0,
    messageId: null,
    errorName: null,
    queuedAt: null,
    startedAt: null,
    nextAttemptAt: new Date('2026-07-29T00:00:00.000Z'),
    sentAt: null,
    failedAt: null,
    createdAt: new Date('2026-07-29T00:00:00.000Z'),
    updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    ...overrides,
  };
}

function prismaFromTransaction(tx: DailyContentTransactionClient): DailyContentPrismaClient {
  return {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
}

describe('createDailyContent', () => {
  it('advisory lock後に件数確認・作成・Auditを行う', async () => {
    const calls: string[] = [];
    const created = schedule();
    const tx = {
      $queryRawUnsafe: vi.fn(async () => calls.push('lock')),
      dailyContent: {
        count: vi.fn(async () => {
          calls.push('count');
          return 0;
        }),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(async () => {
          calls.push('create');
          return created;
        }),
        update: vi.fn(),
        delete: vi.fn(),
      },
      dailyContentDelivery: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(async () => {
          calls.push('audit');
          return {};
        }),
      },
      guildPlugin: { findUnique: vi.fn() },
    } as unknown as DailyContentTransactionClient;

    const result = await createDailyContent(prismaFromTransaction(tx), {
      guildId: 'guild-1',
      actorId: 'user-1',
      config: normalizeDailyContentConfig({}),
      now: new Date('2026-07-28T00:00:00.000Z'),
      schedule: {
        channelId: '123456789012345678',
        title: '朝のお知らせ',
        content: 'おはようございます',
        scheduleTime: '09:00',
        timezone: 'Asia/Tokyo',
      },
    });

    expect(result).toBe(created);
    expect(calls).toEqual(['lock', 'count', 'create', 'audit']);
  });
});

describe('reserveDueDelivery', () => {
  it('予定時刻からidempotency keyを作り次回時刻を更新する', async () => {
    const current = schedule();
    const createdDelivery = delivery();
    const create = vi.fn(async () => createdDelivery);
    const update = vi.fn(async () => current);
    const tx = {
      $queryRawUnsafe: vi.fn(async () => undefined),
      dailyContent: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(async () => current),
        create: vi.fn(),
        update,
        delete: vi.fn(),
      },
      dailyContentDelivery: {
        findMany: vi.fn(),
        findFirst: vi.fn(async () => null),
        create,
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      guildPlugin: { findUnique: vi.fn() },
    } as unknown as DailyContentTransactionClient;

    const result = await reserveDueDelivery(
      prismaFromTransaction(tx),
      'schedule-1',
      new Date('2026-07-29T00:00:01.000Z'),
    );

    expect(result).toBe(createdDelivery);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'schedule-1:2026-07-29T00:00:00.000Z',
          status: 'pending',
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastScheduledAt: new Date('2026-07-29T00:00:00.000Z'),
          nextRunAt: new Date('2026-07-30T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('同じidempotency keyの履歴があれば新規作成しない', async () => {
    const current = schedule();
    const existing = delivery();
    const create = vi.fn();
    const tx = {
      $queryRawUnsafe: vi.fn(async () => undefined),
      dailyContent: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(async () => current),
        create: vi.fn(),
        update: vi.fn(async () => current),
        delete: vi.fn(),
      },
      dailyContentDelivery: {
        findMany: vi.fn(),
        findFirst: vi.fn(async () => existing),
        create,
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      guildPlugin: { findUnique: vi.fn() },
    } as unknown as DailyContentTransactionClient;

    const result = await reserveDueDelivery(
      prismaFromTransaction(tx),
      'schedule-1',
      new Date('2026-07-29T00:00:01.000Z'),
    );

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('stale recovery and retry', () => {
  it('stale配信をretryingへ戻す', async () => {
    const update = vi.fn(async () => delivery({ status: 'retrying' }));
    const tx = {
      dailyContentDelivery: { update },
    } as unknown as DailyContentPrismaClient;
    const now = new Date('2026-07-29T01:00:00.000Z');

    await recoverStaleDelivery(tx, 'delivery-1', now);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'retrying',
        errorName: 'DailyContentStaleRecovered',
        nextAttemptAt: now,
      },
    });
  });

  it('失敗済み配信だけを手動再実行できる', async () => {
    const failed = delivery({ status: 'failed', errorName: 'DiscordError' });
    const updated = delivery({ status: 'retrying', errorName: null });
    const tx = {
      $queryRawUnsafe: vi.fn(async () => undefined),
      dailyContent: {} as never,
      dailyContentDelivery: {
        findFirst: vi.fn(async () => failed),
        update: vi.fn(async () => updated),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      guildPlugin: {} as never,
    } as unknown as DailyContentTransactionClient;

    const result = await retryDailyContentDelivery(prismaFromTransaction(tx), {
      guildId: 'guild-1',
      deliveryId: 'delivery-1',
      actorId: 'user-1',
      now: new Date('2026-07-29T01:00:00.000Z'),
    });

    expect(result).toBe(updated);
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
