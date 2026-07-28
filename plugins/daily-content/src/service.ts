import {
  DailyContentValidationError,
  normalizeDailyContentInput,
  type DailyContentConfig,
  type DailyContentInput,
} from './config.js';
import { dailyContentIdempotencyKey, nextDailyOccurrence } from './schedule.js';

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
  nextRunAt: Date | null;
  lastScheduledAt: Date | null;
  lastSentAt: Date | null;
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
  const normalized = normalizeDailyContentInput(input.schedule, input.config);
  const nextRunAt = normalized.enabled
    ? nextDailyOccurrence({
        scheduleTime: normalized.scheduleTime,
        timezone: normalized.timezone,
        after: now,
      })
    : null;

  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    const count = await tx.dailyContent.count({ where: { guildId: input.guildId } });
    if (count >= input.config.maxSchedules) {
      throw new DailyContentValidationError(
        `Daily ContentはGuildごとに最大${input.config.maxSchedules}件までです`,
      );
    }

    const created = await tx.dailyContent.create({
      data: {
        guildId: input.guildId,
        ...normalized,
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
      where: { id: input.scheduleId, guildId: input.guildId },
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
      },
      input.config,
    );
    const scheduleChanged =
      normalized.scheduleTime !== current.scheduleTime ||
      normalized.timezone !== current.timezone ||
      normalized.enabled !== current.enabled;
    const nextRunAt = !normalized.enabled
      ? null
      : scheduleChanged || !current.nextRunAt
        ? nextDailyOccurrence({
            scheduleTime: normalized.scheduleTime,
            timezone: normalized.timezone,
            after: now,
          })
        : current.nextRunAt;

    const updated = await tx.dailyContent.update({
      where: { id: current.id },
      data: {
        ...normalized,
        nextRunAt,
        updatedBy: input.actorId,
      },
    });
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
      where: { id: input.scheduleId, guildId: input.guildId },
    });
    if (!current) return false;
    await tx.dailyContent.delete({ where: { id: current.id } });
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
  return prisma.dailyContent.findFirst({ where: { id: scheduleId, guildId } });
}

export async function listDailyContents(
  prisma: DailyContentPrismaClient,
  guildId: string,
): Promise<DailyContentRecord[]> {
  return prisma.dailyContent.findMany({
    where: { guildId },
    orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function listDueDailyContents(
  prisma: DailyContentPrismaClient,
  now: Date,
  limit = 100,
): Promise<DailyContentRecord[]> {
  return prisma.dailyContent.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
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
    const schedule = await tx.dailyContent.findFirst({ where: { id: scheduleId } });
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

    const nextRunAt = nextDailyOccurrence({
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: scheduledFor,
    });
    await tx.dailyContent.update({
      where: { id: schedule.id },
      data: { nextRunAt, lastScheduledAt: scheduledFor },
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
      where: { id: input.scheduleId, guildId: input.guildId },
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
  input: { deliveryId: string; scheduleId: string; messageId: string; sentAt?: Date },
): Promise<void> {
  const sentAt = input.sentAt ?? new Date();
  await prisma.$transaction(async (tx) => {
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
      data: { lastSentAt: sentAt },
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
