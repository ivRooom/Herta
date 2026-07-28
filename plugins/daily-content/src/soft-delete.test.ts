import { describe, expect, it, vi } from 'vitest';
import {
  deleteDailyContent,
  type DailyContentPrismaClient,
  type DailyContentTransactionClient,
} from './service.js';

describe('Daily Content soft delete', () => {
  it('スケジュールを無効化・Soft Deleteし、配信履歴を削除しない', async () => {
    const current = {
      id: 'schedule-1',
      guildId: 'guild-1',
      channelId: '123456789012345678',
      title: '朝のお知らせ',
      content: 'おはようございます',
      scheduleTime: '09:00',
      timezone: 'Asia/Tokyo',
      enabled: true,
      nextRunAt: new Date('2026-07-30T00:00:00.000Z'),
      lastScheduledAt: null,
      lastSentAt: null,
      deletedAt: null,
      createdBy: 'user-1',
      updatedBy: 'user-1',
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    };
    const update = vi.fn(async () => ({ ...current, enabled: false, deletedAt: new Date() }));
    const deliveryDelete = vi.fn();
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
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: deliveryDelete,
      },
      auditLog: { create: vi.fn(async () => ({})) },
      guildPlugin: { findUnique: vi.fn() },
    } as unknown as DailyContentTransactionClient;
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as DailyContentPrismaClient;

    const deleted = await deleteDailyContent(prisma, {
      guildId: 'guild-1',
      scheduleId: 'schedule-1',
      actorId: 'user-1',
    });

    expect(deleted).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: expect.objectContaining({
        enabled: false,
        nextRunAt: null,
        deletedAt: expect.any(Date),
        updatedBy: 'user-1',
      }),
    });
    expect(deliveryDelete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'daily_content.delete' }),
      }),
    );
  });
});
