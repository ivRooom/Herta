import {
  DailyContentValidationError,
  normalizeDailyContentInput,
  type DailyContentConfig,
  type DailyContentInput,
} from './config.js';
import { dailyContentIdempotencyKey, nextContentOccurrence } from './schedule.js';

export type DailyContentDeliveryStatus =
  'pending' | 'queued' | 'processing' | 'retrying' | 'sent' | 'failed' | 'skipped';

export type DailyContentDeliveryOrigin = 'scheduled' | 'manual';

export interface DailyContentRecord {
  id: string;
  guildId: string;
  channelId: string;
  title: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
  recurrenceType: 'once' | 'daily' | 'weekly';
  onceAt: Date | null;
  weekdays: number[];
  messageFormat: 'text' | 'embed';
  embedJson: unknown | null;
  publishAnnouncement: boolean;
  nextRunAt: Date | null;
  lastScheduledAt: Date | null;
  lastSentAt: Date | null;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyContentDeliveryRecord {
  id: string;
  dailyContentId: string;
  guildId: string;
  idempotencyKey: string;
  origin: DailyContentDeliveryOrigin;
  scheduledFor: Date;
  status: DailyContentDeliveryStatus;
  attemptCount: number;
  messageId: string | null;
  errorName: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyContentDeliveryWithSchedule extends DailyContentDeliveryRecord {
  dailyContent: DailyContentRecord;
}

interface DailyContentDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<DailyContentRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<DailyContentRecord | null>;
  create(args: Record<string, unknown>): Promise<DailyContentRecord>;
  update(args: Record<string, unknown>): Promise<DailyContentRecord>;
  delete(args: Record<string, unknown>): Promise<DailyContentRecord>;
}

interface DailyContentDeliveryDelegate {
  findMany(args: Record<string, unknown>): Promise<DailyContentDeliveryRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<DailyContentDeliveryRecord | null>;
  create(args: Record<string, unknown>): Promise<DailyContentDeliveryRecord>;
  update(args: Record<string, unknown>): Promise<DailyContentDeliveryRecord>;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

interface GuildPluginDelegate {
  findUnique(args: Record<string, unknown>): Promise<{ enabled: boolean } | null>;
}

export interface DailyContentTransactionClient {
  dailyContent: DailyContentDelegate;
  dailyContentDelivery: DailyContentDeliveryDelegate;
  auditLog: AuditLogDelegate;
  guildPlugin: GuildPluginDelegate;
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

export interface DailyContentPrismaClient extends DailyContentTransactionClient {
  $transaction<T>(callback: (tx: DailyContentTransactionClient) => Promise<T>): Promise<T>;
}

export interface CreateDailyContentInput {
  guildId: string;
  actorId: string;
  schedule: DailyContentInput;
  config: DailyContentConfig;
  now?: Date;
}

export interface UpdateDailyContentInput {
  guildId: string;
  scheduleId: string;
  actorId: string;
  patch: Partial<DailyContentInput>;
  config: DailyContentConfig;
  now?: Date;
}

export async function createDailyContent(
  prisma: DailyContentPrismaClient,
  input: CreateDailyContentInput,
): Promise<DailyContentRecord> {
  const now = input.now ?? new Date();
  const normalized = normalizeDailyContentInput(input.schedule, input.config, now);
  const nextRunAt = normalized.enabled
    ? nextContentOccurrence({
        recurrenceType: normalized.recurrenceType,
        onceAt: normalized.onceAt,
        weekdays: normalized.weekdays,
        scheduleTime: normalized.scheduleTime,
        timezone: normalized.timezone,
        after: now,
      })
    : null;

  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const count = await tx.dailyContent.count({
      where: { guildId: input.guildId, deletedAt: null },
    });
    if (count >= input.config.maxSchedules) {
      throw new DailyContentValidationError(
        `Daily ContentはGuildごとに最大${input.config.maxSchedules}件までです`,
      );
    }

    const { embed, ...stored } = normalized;
    const created = await tx.dailyContent.create({
      data: {
        guildId: input.guildId,
        ...stored,
        ...(embed ? { embedJson: embed } : {}),
        nextRunAt,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'daily_content.create',
        targetType: 'daily_content',
        targetId: created.id,
        changes: {
          channelId: normalized.channelId,
          scheduleTime: normalized.scheduleTime,
          timezone: normalized.timezone,
          enabled: normalized.enabled,
        },
      },
    });
    return created;
  });
}

export async function updateDailyContent(
  prisma: DailyContentPrismaClient,
  input: UpdateDailyContentInput,
): Promise<DailyContentRecord | null> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const current = await tx.dailyContent.findFirst({
      where: { id: input.scheduleId, guildId: input.guildId, deletedAt: null },
    });
    if (!current) return null;

    const normalized = normalizeDailyContentInput(
      {
        channelId: input.patch.channelId ?? current.channelId,
        title: input.patch.title ?? current.title,
        content: input.patch.content ?? current.content,
        scheduleTime: input.patch.scheduleTime ?? current.scheduleTime,
        timezone: input.patch.timezone ?? current.timezone,
        enabled: input.patch.enabled ?? current.enabled,
        recurrenceType: input.patch.recurrenceType ?? current.recurrenceType,
        onceAt: input.patch.onceAt !== undefined ? input.patch.onceAt : current.onceAt,
        weekdays: input.patch.weekdays !== undefined ? input.patch.weekdays : current.weekdays,
        messageFormat: input.patch.messageFormat ?? current.messageFormat,
        embed:
          input.patch.embed !== undefined
            ? input.patch.embed
            : (current.embedJson as DailyContentInput['embed']),
        publishAnnouncement:
          !input.config.allowAnnouncementCrosspost && input.patch.publishAnnouncement === undefined
            ? false
            : (input.patch.publishAnnouncement ?? current.publishAnnouncement),
      },
      input.config,
      now,
    );
    const scheduleChanged =
      normalized.scheduleTime !== current.scheduleTime ||
      normalized.timezone !== current.timezone ||
      normalized.enabled !== current.enabled ||
      normalized.recurrenceType !== current.recurrenceType ||
      normalized.onceAt?.getTime() !== current.onceAt?.getTime() ||
      normalized.weekdays.join(',') !== current.weekdays.join(',');
    const nextRunAt = !normalized.enabled
      ? null
      : scheduleChanged || !current.nextRunAt
        ? nextContentOccurrence({
            recurrenceType: normalized.recurrenceType,
            onceAt: normalized.onceAt,
            weekdays: normalized.weekdays,
            scheduleTime: normalized.scheduleTime,
            timezone: normalized.timezone,
            after: now,
          })
        : current.nextRunAt;

    const { embed, ...stored } = normalized;
    const updated = await tx.dailyContent.update({
      where: { id: current.id },
      data: {
        ...stored,
        ...(embed ? { embedJson: embed } : {}),
        nextRunAt,
        updatedBy: input.actorId,
      },
    });
    if (!embed) {
      await tx.$queryRawUnsafe(
        'UPDATE daily_contents SET embed_json = NULL WHERE id = $1',
        current.id,
      );
      updated.embedJson = null;
    }
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: normalized.enabled ? 'daily_content.update' : 'daily_content.disable',
        targetType: 'daily_content',
        targetId: current.id,
        changes: {
          channelId: normalized.channelId,
          scheduleTime: normalized.scheduleTime,
          timezone: normalized.timezone,
          enabled: normalized.enabled,
        },
      },
    });
    return updated;
  });
}

export async function deleteDailyContent(
  prisma: DailyContentPrismaClient,
  input: { guildId: string; scheduleId: string; actorId: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const current = await tx.dailyContent.findFirst({
      where: { id: input.scheduleId, guildId: input.guildId, deletedAt: null },
    });
    if (!current) return false;
    await tx.dailyContent.update({
      where: { id: current.id },
      data: {
        enabled: false,
        nextRunAt: null,
        deletedAt: new Date(),
        updatedBy: input.actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'daily_content.delete',
        targetType: 'daily_content',
        targetId: current.id,
        changes: {
          channelId: current.channelId,
          scheduleTime: current.scheduleTime,
          timezone: current.timezone,
        },
      },
    });
    return true;
  });
}

export async function getDailyContent(
  prisma: DailyContentPrismaClient,
  guildId: string,
  scheduleId: string,
): Promise<DailyContentRecord | null> {
  return prisma.dailyContent.findFirst({
    where: { id: scheduleId, guildId, deletedAt: null },
  });
}

export async function listDailyContents(
  prisma: DailyContentPrismaClient,
  guildId: string,
): Promise<DailyContentRecord[]> {
  return prisma.dailyContent.findMany({
    where: { guildId, deletedAt: null },
    orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function listDueDailyContents(
  prisma: DailyContentPrismaClient,
  now: Date,
  limit = 100,
): Promise<DailyContentRecord[]> {
  return prisma.dailyContent.findMany({
    where: { enabled: true, deletedAt: null, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: Math.min(500, Math.max(1, limit)),
  });
}

export async function reserveDueDelivery(
  prisma: DailyContentPrismaClient,
  scheduleId: string,
  now = new Date(),
): Promise<DailyContentDeliveryRecord | null> {
  return prisma.$transaction(async (tx) => {
    await lockSchedule(tx, scheduleId);
    const schedule = await tx.dailyContent.findFirst({
      where: { id: scheduleId, deletedAt: null },
    });
    if (!schedule?.enabled || !schedule.nextRunAt || schedule.nextRunAt.getTime() > now.getTime()) {
      return null;
    }

    const scheduledFor = schedule.nextRunAt;
    const idempotencyKey = dailyContentIdempotencyKey(schedule.id, scheduledFor);
    let delivery = await tx.dailyContentDelivery.findFirst({ where: { idempotencyKey } });
    if (!delivery) {
      delivery = await tx.dailyContentDelivery.create({
        data: {
          dailyContentId: schedule.id,
          guildId: schedule.guildId,
          idempotencyKey,
          origin: 'scheduled',
          scheduledFor,
          status: 'pending',
          attemptCount: 0,
          nextAttemptAt: now,
        },
      });
    }

    const nextRunAt = nextContentOccurrence({
      recurrenceType: schedule.recurrenceType,
      onceAt: schedule.onceAt,
      weekdays: schedule.weekdays,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: scheduledFor,
    });
    await tx.dailyContent.update({
      where: { id: schedule.id },
      data: {
        nextRunAt,
        lastScheduledAt: scheduledFor,
      },
    });
    return delivery;
  });
}

export async function reserveManualDelivery(
  prisma: DailyContentPrismaClient,
  input: {
    guildId: string;
    scheduleId: string;
    actorId: string;
    requestId: string;
    requestedAt?: Date;
  },
): Promise<DailyContentDeliveryRecord | null> {
  const requestedAt = input.requestedAt ?? new Date();
  const requestId = input.requestId.trim();
  if (!requestId) throw new DailyContentValidationError('requestIdは必須です');

  return prisma.$transaction(async (tx) => {
    await lockSchedule(tx, input.scheduleId);
    const schedule = await tx.dailyContent.findFirst({
      where: { id: input.scheduleId, guildId: input.guildId, deletedAt: null },
    });
    if (!schedule) return null;

    const idempotencyKey = `${schedule.id}:manual:${requestId}`;
    const existing = await tx.dailyContentDelivery.findFirst({ where: { idempotencyKey } });
    if (existing) return existing;

    const delivery = await tx.dailyContentDelivery.create({
      data: {
        dailyContentId: schedule.id,
        guildId: schedule.guildId,
        idempotencyKey,
        origin: 'manual',
        scheduledFor: requestedAt,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: requestedAt,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'daily_content.manual_publish',
        targetType: 'daily_content',
        targetId: schedule.id,
        metadata: { deliveryId: delivery.id },
      },
    });
    return delivery;
  });
}

export async function listPendingDeliveries(
  prisma: DailyContentPrismaClient,
  now: Date,
  limit = 100,
): Promise<DailyContentDeliveryRecord[]> {
  return prisma.dailyContentDelivery.findMany({
    where: {
      status: { in: ['pending', 'retrying'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(500, Math.max(1, limit)),
  });
}

export async function getDeliveryWithSchedule(
  prisma: DailyContentPrismaClient,
  deliveryId: string,
): Promise<DailyContentDeliveryWithSchedule | null> {
  const result = await prisma.dailyContentDelivery.findFirst({
    where: { id: deliveryId },
    include: { dailyContent: true },
  });
  return result as DailyContentDeliveryWithSchedule | null;
}

export async function markDeliveryQueued(
  prisma: DailyContentPrismaClient,
  deliveryId: string,
  queuedAt = new Date(),
): Promise<void> {
  await prisma.dailyContentDelivery.update({
    where: { id: deliveryId },
    data: { status: 'queued', queuedAt },
  });
}

export async function markDeliveryProcessing(
  prisma: DailyContentPrismaClient,
  deliveryId: string,
  startedAt = new Date(),
): Promise<void> {
  await prisma.dailyContentDelivery.update({
    where: { id: deliveryId },
    data: { status: 'processing', startedAt, attemptCount: { increment: 1 } },
  });
}

export async function markDeliveryRetrying(
  prisma: DailyContentPrismaClient,
  input: { deliveryId: string; errorName: string; nextAttemptAt: Date },
): Promise<void> {
  await prisma.dailyContentDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: 'retrying',
      errorName: input.errorName,
      nextAttemptAt: input.nextAttemptAt,
      failedAt: null,
    },
  });
}

export async function markDeliverySent(
  prisma: DailyContentPrismaClient,
  input: {
    deliveryId: string;
    scheduleId: string;
    guildId: string;
    messageId: string;
    sentAt?: Date;
    completeOneShot?: boolean;
    expectedOneShotAt?: Date;
  },
): Promise<void> {
  const sentAt = input.sentAt ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const currentSchedule = await tx.dailyContent.findFirst({
      where: { id: input.scheduleId, guildId: input.guildId },
    });
    const expectedOneShotAt = input.expectedOneShotAt?.getTime();
    const shouldCompleteOneShot =
      input.completeOneShot === true &&
      expectedOneShotAt !== undefined &&
      currentSchedule?.deletedAt === null &&
      currentSchedule.enabled === true &&
      currentSchedule.recurrenceType === 'once' &&
      currentSchedule.onceAt?.getTime() === expectedOneShotAt &&
      currentSchedule.lastScheduledAt?.getTime() === expectedOneShotAt;

    await tx.dailyContentDelivery.update({
      where: { id: input.deliveryId },
      data: {
        status: 'sent',
        messageId: input.messageId,
        errorName: null,
        nextAttemptAt: null,
        sentAt,
        failedAt: null,
      },
    });
    await tx.dailyContent.update({
      where: { id: input.scheduleId },
      data: {
        lastSentAt: sentAt,
        ...(shouldCompleteOneShot ? { enabled: false, nextRunAt: null } : {}),
      },
    });
  });
}

export async function markDeliveryFailed(
  prisma: DailyContentPrismaClient,
  input: { deliveryId: string; errorName: string; failedAt?: Date },
): Promise<void> {
  const failedAt = input.failedAt ?? new Date();
  await prisma.dailyContentDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: 'failed',
      errorName: input.errorName,
      nextAttemptAt: null,
      failedAt,
    },
  });
}

export async function markDeliverySkipped(
  prisma: DailyContentPrismaClient,
  input: { deliveryId: string; errorName: string },
): Promise<void> {
  await prisma.dailyContentDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: 'skipped',
      errorName: input.errorName,
      nextAttemptAt: null,
      failedAt: new Date(),
    },
  });
}

export async function listStaleDeliveries(
  prisma: DailyContentPrismaClient,
  staleBefore: Date,
  limit = 100,
): Promise<DailyContentDeliveryRecord[]> {
  return prisma.dailyContentDelivery.findMany({
    where: { status: 'processing', startedAt: { lt: staleBefore } },
    orderBy: { startedAt: 'asc' },
    take: Math.min(500, Math.max(1, limit)),
  });
}

export async function recoverStaleDelivery(
  prisma: DailyContentPrismaClient,
  deliveryId: string,
  now = new Date(),
): Promise<void> {
  await prisma.dailyContentDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'retrying',
      errorName: 'DailyContentStaleRecovered',
      nextAttemptAt: now,
    },
  });
}

export async function isDailyContentPluginEnabled(
  prisma: DailyContentPrismaClient,
  guildId: string,
): Promise<boolean> {
  const row = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId: 'daily-content' } },
    select: { enabled: true },
  });
  return row?.enabled === true;
}

export async function listDeliveryHistory(
  prisma: DailyContentPrismaClient,
  guildId: string,
  limit = 50,
): Promise<DailyContentDeliveryRecord[]> {
  return prisma.dailyContentDelivery.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
  });
}

async function lockGuild(tx: DailyContentTransactionClient, guildId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `daily-content:guild:${guildId}`,
  );
}

async function lockSchedule(tx: DailyContentTransactionClient, scheduleId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `daily-content:schedule:${scheduleId}`,
  );
}
