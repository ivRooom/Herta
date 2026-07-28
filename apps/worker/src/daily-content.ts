import { createHash } from 'node:crypto';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import { Redis } from 'ioredis';
import { QueueNames, type JobData } from '@herta/queue';
import {
  getDeliveryWithSchedule,
  listDueDailyContents,
  listPendingDeliveries,
  listStaleDeliveries,
  markDeliveryFailed,
  markDeliveryProcessing,
  markDeliveryQueued,
  markDeliveryRetrying,
  markDeliverySent,
  markDeliverySkipped,
  nextDailyOccurrence,
  normalizeDailyContentConfig,
  recoverStaleDelivery,
  reserveDueDelivery,
  type DailyContentConfig,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DAILY_CONTENT_SCAN_LIMIT = 200;
const BASE_RETRY_DELAY_MS = 15_000;
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const DISCORD_NONCE_MAX_LENGTH = 25;

type DailyContentJobData = JobData[typeof QueueNames.DAILY_CONTENT];

export interface DailyContentRuntime {
  scanNow(now?: Date): Promise<void>;
  close(): Promise<void>;
}

export interface StartDailyContentRuntimeOptions {
  redisUrl: string;
  prisma: PrismaClient;
  logger: Logger;
  discordBotToken: string;
}

export function createDeliveryNonce(idempotencyKey: string): string {
  return createHash('sha256')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, DISCORD_NONCE_MAX_LENGTH);
}

export async function startDailyContentRuntime(
  options: StartDailyContentRuntimeOptions,
): Promise<DailyContentRuntime> {
  const queueConnection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  const workerConnection = queueConnection.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  queueConnection.on('error', () => {
    options.logger.warn('Daily Content Queue用Redis接続でエラーが発生しました');
  });
  workerConnection.on('error', () => {
    options.logger.warn('Daily Content Worker用Redis接続でエラーが発生しました');
  });
  await Promise.all([queueConnection.connect(), workerConnection.connect()]);

  const queue = new Queue<DailyContentJobData>(QueueNames.DAILY_CONTENT, {
    connection: queueConnection,
    defaultJobOptions: {
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
    },
  });
  const prisma = options.prisma as unknown as DailyContentPrismaClient;
  const worker = new Worker<DailyContentJobData>(
    QueueNames.DAILY_CONTENT,
    async (job) => processDelivery(job, options, prisma),
    {
      connection: workerConnection,
      concurrency: 5,
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );
  worker.on('failed', (job, error) => {
    options.logger.warn(
      {
        deliveryId: job?.data.deliveryId,
        errorName: resolveErrorName(error),
      },
      'Daily Content配信ジョブが失敗しました',
    );
  });
  worker.on('error', (error) => {
    options.logger.error({ errorName: resolveErrorName(error) }, 'Daily Content Workerエラー');
  });

  let scanning = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  const scanNow = async (now = new Date()): Promise<void> => {
    if (scanning || closed) return;
    scanning = true;
    try {
      await initializeMissingNextRuns(options.prisma, now);
      await recoverStale(prisma, now, options.logger);
      const dueSchedules = await listDueDailyContents(prisma, now, DAILY_CONTENT_SCAN_LIMIT);
      for (const schedule of dueSchedules) {
        await reserveDueDelivery(prisma, schedule.id, now);
      }

      const pending = await listPendingDeliveries(prisma, now, DAILY_CONTENT_SCAN_LIMIT);
      for (const delivery of pending) {
        const config = await resolveGuildConfig(options.prisma, delivery.guildId);
        await queue.add(
          'publish',
          {
            deliveryId: delivery.id,
            scheduleId: delivery.dailyContentId,
            guildId: delivery.guildId,
            idempotencyKey: delivery.idempotencyKey,
            scheduledFor: delivery.scheduledFor.toISOString(),
          },
          {
            jobId: delivery.id,
            attempts: config.maxAttempts,
            backoff: { type: 'exponential', delay: BASE_RETRY_DELAY_MS },
          },
        );
        await markDeliveryQueued(prisma, delivery.id, now);
      }
    } catch (error) {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'Daily Contentのdue判定またはenqueueに失敗しました',
      );
    } finally {
      scanning = false;
    }
  };

  const schedulerConfig = normalizeDailyContentConfig({});
  await scanNow();
  timer = setInterval(() => {
    void scanNow();
  }, schedulerConfig.scanIntervalSeconds * 1000);
  timer.unref();

  return {
    scanNow,
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      await Promise.allSettled([worker.close(), queue.close()]);
      await Promise.allSettled([workerConnection.quit(), queueConnection.quit()]);
    },
  };
}

async function processDelivery(
  job: Job<DailyContentJobData>,
  options: StartDailyContentRuntimeOptions,
  prisma: DailyContentPrismaClient,
): Promise<void> {
  const delivery = await getDeliveryWithSchedule(prisma, job.data.deliveryId);
  if (!delivery) throw new UnrecoverableError('DailyContentDeliveryNotFound');
  if (delivery.status === 'sent' || delivery.status === 'skipped') return;

  const plugin = await options.prisma.guildPlugin.findUnique({
    where: {
      guildId_pluginId: {
        guildId: delivery.guildId,
        pluginId: 'daily-content',
      },
    },
    select: { enabled: true, config: true },
  });
  if (!plugin?.enabled || !delivery.dailyContent.enabled) {
    await markDeliverySkipped(prisma, {
      deliveryId: delivery.id,
      errorName: plugin?.enabled ? 'DailyContentScheduleDisabled' : 'DailyContentPluginDisabled',
    });
    return;
  }

  const config = normalizeDailyContentConfig(plugin.config);
  await markDeliveryProcessing(prisma, delivery.id);
  try {
    const messageId = await publishDiscordMessage({
      token: options.discordBotToken,
      channelId: delivery.dailyContent.channelId,
      content: delivery.dailyContent.content,
      allowUserMentions: config.allowUserMentions,
      nonce: createDeliveryNonce(delivery.idempotencyKey),
    });
    await markDeliverySent(prisma, {
      deliveryId: delivery.id,
      scheduleId: delivery.dailyContent.id,
      messageId,
    });
    options.logger.info(
      {
        guildId: delivery.guildId,
        scheduleId: delivery.dailyContent.id,
        deliveryId: delivery.id,
        origin: delivery.origin,
      },
      'Daily Contentを配信しました',
    );
  } catch (error) {
    const errorName = resolveErrorName(error);
    const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    const hasNextAttempt = isRetryable(error) && job.attemptsMade + 1 < attempts;
    if (hasNextAttempt) {
      const nextAttemptAt = new Date(
        Date.now() + BASE_RETRY_DELAY_MS * 2 ** Math.max(0, job.attemptsMade),
      );
      await markDeliveryRetrying(prisma, {
        deliveryId: delivery.id,
        errorName,
        nextAttemptAt,
      });
      throw error;
    }

    await markDeliveryFailed(prisma, { deliveryId: delivery.id, errorName });
    throw new UnrecoverableError(errorName);
  }
}

async function publishDiscordMessage(input: {
  token: string;
  channelId: string;
  content: string;
  allowUserMentions: boolean;
  nonce: string;
}): Promise<string> {
  const channelResponse = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}`, {
    headers: { Authorization: `Bot ${input.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!channelResponse.ok) {
    throw await createDiscordError('DailyContentChannelPreflightFailed', channelResponse);
  }
  const channel = (await channelResponse.json()) as { type?: unknown };
  if (typeof channel.type !== 'number' || !TEXT_CHANNEL_TYPES.has(channel.type)) {
    throw new DailyContentPublishError('DailyContentChannelNotTextBased', channelResponse.status);
  }

  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: input.content,
      nonce: input.nonce,
      enforce_nonce: true,
      allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw await createDiscordError('DailyContentDiscordPublishFailed', response);
  }
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !message.id) {
    throw new DailyContentPublishError('DailyContentDiscordResponseInvalid', response.status);
  }
  return message.id;
}

async function createDiscordError(prefix: string, response: Response): Promise<Error> {
  let code: string | undefined;
  try {
    const payload = (await response.json()) as { code?: unknown };
    if (typeof payload.code === 'number' || typeof payload.code === 'string') {
      code = String(payload.code);
    }
  } catch {
    code = undefined;
  }
  return new DailyContentPublishError(code ? `${prefix}:${code}` : prefix, response.status);
}

class DailyContentPublishError extends Error {
  constructor(
    name: string,
    readonly status: number,
  ) {
    super(name);
    this.name = name;
  }
}

async function initializeMissingNextRuns(prisma: PrismaClient, now: Date): Promise<void> {
  const schedules = await prisma.dailyContent.findMany({
    where: { enabled: true, nextRunAt: null },
    select: { id: true, scheduleTime: true, timezone: true },
    take: DAILY_CONTENT_SCAN_LIMIT,
  });
  for (const schedule of schedules) {
    const nextRunAt = nextDailyOccurrence({
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: now,
    });
    await prisma.dailyContent.update({
      where: { id: schedule.id },
      data: { nextRunAt },
    });
  }
}

async function recoverStale(
  prisma: DailyContentPrismaClient,
  now: Date,
  logger: Logger,
): Promise<void> {
  const config = normalizeDailyContentConfig({});
  const staleBefore = new Date(now.getTime() - config.staleAfterMinutes * 60 * 1000);
  const stale = await listStaleDeliveries(prisma, staleBefore, DAILY_CONTENT_SCAN_LIMIT);
  for (const delivery of stale) {
    await recoverStaleDelivery(prisma, delivery.id, now);
    logger.warn(
      { deliveryId: delivery.id, guildId: delivery.guildId },
      'staleなDaily Content配信を再キュー対象へ戻しました',
    );
  }
}

async function resolveGuildConfig(
  prisma: PrismaClient,
  guildId: string,
): Promise<DailyContentConfig> {
  const plugin = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId: 'daily-content' } },
    select: { config: true },
  });
  return normalizeDailyContentConfig(plugin?.config);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof DailyContentPublishError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || resolveErrorName(error) === 'TimeoutError';
}

function resolveErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error.name.trim() && error.name !== 'Error') return error.name.slice(0, 120);
  return (error.message.trim() || 'Error').slice(0, 120);
}
