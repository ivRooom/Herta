import { describe, expect, it } from 'vitest';
import {
  markDeliverySent,
  reserveDueDelivery,
  type DailyContentDeliveryRecord,
  type DailyContentPrismaClient,
  type DailyContentRecord,
  type DailyContentTransactionClient,
} from './service.js';

function createHarness() {
  const scheduledFor = new Date('2030-01-01T00:10:00Z');
  let schedule: DailyContentRecord = {
    id: 'schedule-1',
    guildId: 'guild-1',
    channelId: '123456789012345678',
    title: 'one-shot',
    content: 'content',
    scheduleTime: '00:10',
    timezone: 'UTC',
    enabled: true,
    recurrenceType: 'once',
    onceAt: scheduledFor,
    weekdays: [],
    messageFormat: 'text',
    embedJson: null,
    publishAnnouncement: false,
    nextRunAt: scheduledFor,
    lastScheduledAt: null,
    lastSentAt: null,
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date('2029-12-01T00:00:00Z'),
    updatedAt: new Date('2029-12-01T00:00:00Z'),
  };
  let delivery: DailyContentDeliveryRecord | null = null;

  const tx = {
    dailyContent: {
      count: async () => 1,
      findMany: async () => [schedule],
      findFirst: async () => schedule,
      create: async () => schedule,
      update: async (args: Record<string, unknown>) => {
        const data = (args['data'] ?? {}) as Partial<DailyContentRecord>;
        schedule = { ...schedule, ...data };
        return schedule;
      },
      delete: async () => schedule,
    },
    dailyContentDelivery: {
      findMany: async () => (delivery ? [delivery] : []),
      findFirst: async () => delivery,
      create: async (args: Record<string, unknown>) => {
        const data = args['data'] as Record<string, unknown>;
        const now = new Date('2030-01-01T00:10:00Z');
        delivery = {
          id: 'delivery-1',
          dailyContentId: String(data['dailyContentId']),
          guildId: String(data['guildId']),
          idempotencyKey: String(data['idempotencyKey']),
          origin: 'scheduled',
          scheduledFor: data['scheduledFor'] as Date,
          status: 'pending',
          attemptCount: 0,
          messageId: null,
          errorName: null,
          queuedAt: null,
          startedAt: null,
          nextAttemptAt: data['nextAttemptAt'] as Date,
          sentAt: null,
          failedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        return delivery;
      },
      update: async (args: Record<string, unknown>) => {
        if (!delivery) throw new Error('delivery missing');
        const data = (args['data'] ?? {}) as Partial<DailyContentDeliveryRecord>;
        delivery = { ...delivery, ...data };
        return delivery;
      },
    },
    auditLog: { create: async () => ({}) },
    guildPlugin: { findUnique: async () => ({ enabled: true }) },
    $queryRawUnsafe: async () => [],
  } as unknown as DailyContentTransactionClient;

  const prisma = {
    ...tx,
    $transaction: async <T>(callback: (client: DailyContentTransactionClient) => Promise<T>) =>
      callback(tx),
  } as unknown as DailyContentPrismaClient;

  return { prisma, scheduledFor, getSchedule: () => schedule, getDelivery: () => delivery };
}

describe('Message Studio one-shot delivery lifecycle', () => {
  it('予約確保時は有効のまま、予約配信成功後にだけ無効化する', async () => {
    const harness = createHarness();
    const reserved = await reserveDueDelivery(harness.prisma, 'schedule-1', harness.scheduledFor);

    expect(reserved?.status).toBe('pending');
    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().nextRunAt).toBeNull();

    const sentAt = new Date('2030-01-01T00:10:05Z');
    await markDeliverySent(harness.prisma, {
      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      messageId: 'message-1',
      sentAt,
      completeOneShot: true,
    });

    expect(harness.getDelivery()?.status).toBe('sent');
    expect(harness.getSchedule().enabled).toBe(false);
    expect(harness.getSchedule().lastSentAt).toEqual(sentAt);
  });
});
