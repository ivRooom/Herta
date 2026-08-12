import { describe, expect, it } from 'vitest';
import { normalizeDailyContentConfig } from './config.js';
import {
  markDeliverySent,
  reserveDueDelivery,
  updateDailyContent,
  type DailyContentDeliveryRecord,
  type DailyContentPrismaClient,
  type DailyContentRecord,
  type DailyContentTransactionClient,
} from './service.js';

function createHarness(overrides: Partial<DailyContentRecord> = {}) {
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
    ...overrides,
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
    $executeRawUnsafe: async () => 1,
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
      guildId: 'guild-1',
      messageId: 'message-1',
      sentAt,
      completeOneShot: true,
      expectedOneShotAt: harness.scheduledFor,
    });

    expect(harness.getDelivery()?.status).toBe('sent');
    expect(harness.getSchedule().enabled).toBe(false);
    expect(harness.getSchedule().lastSentAt).toEqual(sentAt);
  });

  it('Crosspost設定をOFFにした後も既存予約を編集でき、保存済みフラグを解除する', async () => {
    const harness = createHarness({
      recurrenceType: 'daily',
      onceAt: null,
      scheduleTime: '09:00',
      publishAnnouncement: true,
      nextRunAt: new Date('2030-01-02T09:00:00Z'),
    });

    const updated = await updateDailyContent(harness.prisma, {
      guildId: 'guild-1',
      scheduleId: 'schedule-1',
      actorId: 'user-2',
      config: normalizeDailyContentConfig({ allowAnnouncementCrosspost: false }),
      patch: { title: 'Crosspost解除後も編集可能' },
      now: new Date('2029-12-31T00:00:00Z'),
    });

    expect(updated?.title).toBe('Crosspost解除後も編集可能');
    expect(updated?.publishAnnouncement).toBe(false);
  });

  it('配信中にone-shot日時が編集された場合は新しい予約を無効化しない', async () => {
    const originalAt = new Date('2030-01-01T00:10:00Z');
    const editedAt = new Date('2030-01-02T00:10:00Z');
    const harness = createHarness({
      onceAt: originalAt,
      lastScheduledAt: null,
      nextRunAt: originalAt,
      enabled: true,
    });

    const reserved = await reserveDueDelivery(harness.prisma, 'schedule-1', originalAt);
    expect(reserved?.status).toBe('pending');

    await updateDailyContent(harness.prisma, {
      guildId: 'guild-1',
      scheduleId: 'schedule-1',
      actorId: 'user-2',
      config: normalizeDailyContentConfig({}),
      patch: { onceAt: editedAt },
      now: new Date('2029-12-31T00:00:00Z'),
    });

    await markDeliverySent(harness.prisma, {
      deliveryId: reserved!.id,
      scheduleId: 'schedule-1',
      guildId: 'guild-1',
      messageId: 'message-after-edit',
      completeOneShot: true,
      expectedOneShotAt: originalAt,
    });

    expect(harness.getDelivery()?.status).toBe('sent');
    expect(harness.getSchedule().enabled).toBe(true);
    expect(harness.getSchedule().onceAt).toEqual(editedAt);
    expect(harness.getSchedule().nextRunAt).toEqual(editedAt);
  });
});
