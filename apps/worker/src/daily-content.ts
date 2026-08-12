import { createHash } from 'node:crypto';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import { Redis } from 'ioredis';
import { QueueNames, type JobData } from '@herta/queue';
import {
  checkDailyContentSendPermissions,
  computeDiscordChannelPermissions,
  getDeliveryWithSchedule,
  isDailyContentPluginEnabled,
  listDueDailyContents,
  listPendingDeliveries,
  listStaleDeliveries,
  markDeliveryFailed,
  markDeliveryProcessing,
  markDeliveryQueued,
  markDeliveryRetrying,
  markDeliverySent,
  markDeliverySkipped,
  nextContentOccurrence,
  normalizeDailyContentConfig,
  safeEmbedFromJson,
  toDiscordApiEmbed,
  normalizeDailyContentScanIntervalSeconds,
  redisReconnectDelay,
  resolveDailyContentQueueJobDisposition,
  recoverStaleDelivery,
  reserveDueDelivery,
  type DailyContentConfig,
  type DailyContentDeliveryRecord,
  type DiscordPermissionMember,
  type DiscordPermissionOverwrite,
  type DiscordPermissionRole,
  type DailyContentPrismaClient,
} from '@herta/plugin-catalog/daily-content-service';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DAILY_CONTENT_SCAN_LIMIT = 200;
const BASE_RETRY_DELAY_MS = 15_000;
const MESSAGE_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const FORUM_CHANNEL_TYPES = new Set([15]);
const SUPPORTED_CHANNEL_TYPES = new Set([...MESSAGE_CHANNEL_TYPES, ...FORUM_CHANNEL_TYPES]);
const DISCORD_NONCE_MAX_LENGTH = 25;
const DISCORD_PERMISSION_CACHE_TTL_MS = 30_000;
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

type DailyContentJobData = JobData[typeof QueueNames.DAILY_CONTENT];

interface DiscordChannelPayload {
  id: string;
  type: number;
  guild_id?: string;
  parent_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
  thread_metadata?: { archived?: boolean; locked?: boolean };
  message?: { id?: unknown };
}

interface DiscordUserPayload {
  id: string;
}

interface DiscordGuildMemberPayload {
  user?: { id?: string };
  roles?: string[];
}

interface DiscordRolePayload {
  id?: string;
  permissions?: string;
}

interface CachedGuildPermissionContext {
  expiresAt: number;
  member: DiscordPermissionMember;
  roles: DiscordPermissionRole[];
}

let discordBotUserId: string | undefined;
const guildPermissionCache = new Map<string, CachedGuildPermissionContext>();

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
    retryStrategy: redisReconnectDelay,
  });
  const workerConnection = queueConnection.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: redisReconnectDelay,
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
        const pluginEnabled = await isDailyContentPluginEnabled(prisma, schedule.guildId);
        if (!pluginEnabled) {
          await options.prisma.dailyContent.update({
            where: { id: schedule.id },
            data: { nextRunAt: null },
          });
          continue;
        }
        await reserveDueDelivery(prisma, schedule.id, now);
      }

      const pending = await listPendingDeliveries(prisma, now, DAILY_CONTENT_SCAN_LIMIT);
      for (const delivery of pending) {
        const config = await resolveGuildConfig(options.prisma, delivery.guildId);
        await ensureDeliveryJob(queue, prisma, delivery, config, now);
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

  const scanIntervalSeconds = normalizeDailyContentScanIntervalSeconds(
    process.env['DAILY_CONTENT_SCAN_INTERVAL_SECONDS'],
  );
  await scanNow();
  timer = setInterval(() => {
    void scanNow();
  }, scanIntervalSeconds * 1000);
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

async function ensureDeliveryJob(
  queue: Queue<DailyContentJobData>,
  prisma: DailyContentPrismaClient,
  delivery: DailyContentDeliveryRecord,
  config: DailyContentConfig,
  now: Date,
): Promise<void> {
  const existing = await queue.getJob(delivery.id);
  const state = existing ? await existing.getState() : null;
  const disposition = resolveDailyContentQueueJobDisposition(state);
  if (disposition === 'keep') {
    await markDeliveryQueued(prisma, delivery.id, now);
    return;
  }
  if (disposition === 'replace' && existing) {
    await existing.remove();
  }
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
  if (!plugin?.enabled || !delivery.dailyContent.enabled || delivery.dailyContent.deletedAt) {
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
      title: delivery.dailyContent.title,
      content: delivery.dailyContent.content,
      embed:
        delivery.dailyContent.messageFormat === 'embed'
          ? safeEmbedFromJson(delivery.dailyContent.embedJson)
          : null,
      scheduledFor: delivery.scheduledFor,
      timezone: delivery.dailyContent.timezone,
      allowUserMentions: config.allowUserMentions,
      publishAnnouncement:
        delivery.dailyContent.publishAnnouncement && config.allowAnnouncementCrosspost,
      nonce: createDeliveryNonce(delivery.idempotencyKey),
      onCrosspostWarning: ({ messageId, status, errorName }) =>
        options.logger.warn(
          {
            guildId: delivery.guildId,
            scheduleId: delivery.dailyContent.id,
            deliveryId: delivery.id,
            channelId: delivery.dailyContent.channelId,
            messageId,
            status,
            errorName,
          },
          'AnnouncementのCrosspostに失敗しました。元メッセージは配信済みです',
        ),
    });
    await markDeliverySent(prisma, {
      deliveryId: delivery.id,
      scheduleId: delivery.dailyContent.id,
      messageId,
      completeOneShot:
        delivery.origin === 'scheduled' && delivery.dailyContent.recurrenceType === 'once',
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
  title: string;
  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;
  onCrosspostWarning?: (details: { messageId: string; status?: number; errorName: string }) => void;
}): Promise<string> {
  const channelResponse = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}`, {
    headers: { Authorization: `Bot ${input.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!channelResponse.ok) {
    throw await createDiscordError('DailyContentChannelPreflightFailed', channelResponse);
  }
  const channel = (await channelResponse.json()) as DiscordChannelPayload;
  if (typeof channel.type !== 'number' || !SUPPORTED_CHANNEL_TYPES.has(channel.type)) {
    throw new DailyContentPublishError('DailyContentChannelNotSupported', channelResponse.status);
  }

  const isThread = THREAD_CHANNEL_TYPES.has(channel.type);
  if (isThread && channel.thread_metadata?.locked) {
    throw new DailyContentPublishError('DailyContentThreadLocked', 409);
  }
  await assertDiscordCanSend(input.token, channel);
  if (isThread && channel.thread_metadata?.archived) {
    await unarchiveDiscordThread(input.token, channel.id);
  }

  if (FORUM_CHANNEL_TYPES.has(channel.type)) {
    return publishDiscordForumPost(input);
  }
  return publishDiscordChannelMessage(input);
}

async function publishDiscordChannelMessage(input: {
  token: string;
  channelId: string;
  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;
  onCrosspostWarning?: (details: { messageId: string; status?: number; errorName: string }) => void;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: input.content || undefined,
      embeds: embed ? [embed] : undefined,
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
  if (input.publishAnnouncement) {
    try {
      const crosspostResponse = await fetch(
        `${DISCORD_API_BASE_URL}/channels/${input.channelId}/messages/${message.id}/crosspost`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${input.token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!crosspostResponse.ok) {
        input.onCrosspostWarning?.({
          messageId: message.id,
          status: crosspostResponse.status,
          errorName: 'DailyContentCrosspostFailed',
        });
      }
    } catch (error) {
      input.onCrosspostWarning?.({
        messageId: message.id,
        errorName: resolveErrorName(error),
      });
      // Base message is already sent. Do not retry and duplicate it only because crosspost failed.
    }
  }
  return message.id;
}

async function publishDiscordForumPost(input: {
  token: string;
  channelId: string;
  title: string;
  content: string;
  embed: ReturnType<typeof safeEmbedFromJson>;
  scheduledFor: Date;
  timezone: string;
  allowUserMentions: boolean;
  publishAnnouncement: boolean;
  nonce: string;
}): Promise<string> {
  const embed = toDiscordApiEmbed(input.embed);
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API_BASE_URL}/channels/${input.channelId}/threads`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: resolveForumPostTitle(input.title, input.scheduledFor, input.timezone),
        message: {
          content: input.content || undefined,
          embeds: embed ? [embed] : undefined,
          allowed_mentions: { parse: input.allowUserMentions ? ['users'] : [] },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DailyContentForumPublishError('DailyContentForumPublishAmbiguous', 0);
  }
  if (!response.ok) {
    const error = await createDiscordError('DailyContentForumPublishFailed', response);
    throw new DailyContentForumPublishError(error.name, response.status);
  }

  try {
    const thread = (await response.json()) as DiscordChannelPayload;
    const messageId = thread.message?.id;
    if (typeof messageId !== 'string' || !messageId) {
      throw new DailyContentForumPublishError('DailyContentForumResponseInvalid', response.status);
    }
    return messageId;
  } catch (error) {
    if (error instanceof DailyContentForumPublishError) throw error;
    throw new DailyContentForumPublishError('DailyContentForumPublishAmbiguous', response.status);
  }
}

export function resolveForumPostTitle(
  title: string,
  scheduledFor: Date,
  timezone = 'Asia/Tokyo',
): string {
  const normalized = title.trim();
  if (normalized) return normalized.slice(0, 100);
  const date = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(scheduledFor);
  return `Daily Content ${date}`.slice(0, 100);
}

async function assertDiscordCanSend(
  token: string,
  targetChannel: DiscordChannelPayload,
): Promise<void> {
  const isThread = THREAD_CHANNEL_TYPES.has(targetChannel.type);
  const permissionChannel =
    isThread && targetChannel.parent_id
      ? await fetchDiscordJson<DiscordChannelPayload>(
          token,
          `/channels/${targetChannel.parent_id}`,
          'DailyContentParentChannelPreflightFailed',
        )
      : targetChannel;
  const guildId = targetChannel.guild_id ?? permissionChannel.guild_id;
  if (!guildId) {
    throw new DailyContentPublishError('DailyContentGuildUnavailable', 400);
  }

  const botUserId = await getDiscordBotUserId(token);
  const context = await getGuildPermissionContext(token, guildId, botUserId);
  const permissions = computeDiscordChannelPermissions({
    guildId,
    member: context.member,
    roles: context.roles,
    overwrites: permissionChannel.permission_overwrites ?? [],
  });
  const check = checkDailyContentSendPermissions(permissions, isThread);
  if (!check.allowed) {
    throw new DailyContentPublishError(
      `DailyContentBotPermissionDenied:${check.missing.join(',')}`,
      403,
    );
  }
}

async function unarchiveDiscordThread(token: string, threadId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${threadId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw await createDiscordError('DailyContentThreadUnarchiveFailed', response);
  }
}

async function getDiscordBotUserId(token: string): Promise<string> {
  if (discordBotUserId) return discordBotUserId;
  const user = await fetchDiscordJson<DiscordUserPayload>(
    token,
    '/users/@me',
    'DailyContentBotIdentityFailed',
  );
  if (typeof user.id !== 'string' || !user.id) {
    throw new DailyContentPublishError('DailyContentBotIdentityInvalid', 502);
  }
  discordBotUserId = user.id;
  return user.id;
}

async function getGuildPermissionContext(
  token: string,
  guildId: string,
  botUserId: string,
): Promise<CachedGuildPermissionContext> {
  const cached = guildPermissionCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const [rolePayloads, memberPayload] = await Promise.all([
    fetchDiscordJson<DiscordRolePayload[]>(
      token,
      `/guilds/${guildId}/roles`,
      'DailyContentGuildRolesPreflightFailed',
    ),
    fetchDiscordJson<DiscordGuildMemberPayload>(
      token,
      `/guilds/${guildId}/members/${botUserId}`,
      'DailyContentBotMemberPreflightFailed',
    ),
  ]);
  const roles = rolePayloads.flatMap((role) =>
    typeof role.id === 'string' && typeof role.permissions === 'string'
      ? [{ id: role.id, permissions: role.permissions }]
      : [],
  );
  const member: DiscordPermissionMember = {
    userId: memberPayload.user?.id ?? botUserId,
    roleIds: Array.isArray(memberPayload.roles)
      ? memberPayload.roles.filter((roleId): roleId is string => typeof roleId === 'string')
      : [],
  };
  const context = {
    expiresAt: Date.now() + DISCORD_PERMISSION_CACHE_TTL_MS,
    roles,
    member,
  };
  guildPermissionCache.set(guildId, context);
  return context;
}

async function fetchDiscordJson<T>(token: string, endpoint: string, errorName: string): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await createDiscordError(errorName, response);
  return (await response.json()) as T;
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

class DailyContentForumPublishError extends DailyContentPublishError {}

async function initializeMissingNextRuns(prisma: PrismaClient, now: Date): Promise<void> {
  const schedules = await prisma.dailyContent.findMany({
    where: { enabled: true, deletedAt: null, nextRunAt: null },
    select: {
      id: true,
      guildId: true,
      scheduleTime: true,
      timezone: true,
      recurrenceType: true,
      onceAt: true,
      weekdays: true,
      lastScheduledAt: true,
    },
    take: DAILY_CONTENT_SCAN_LIMIT,
  });
  for (const schedule of schedules) {
    const pluginEnabled = await isDailyContentPluginEnabled(
      prisma as unknown as DailyContentPrismaClient,
      schedule.guildId,
    );
    if (!pluginEnabled) continue;
    const recurrenceType =
      schedule.recurrenceType === 'once' || schedule.recurrenceType === 'weekly'
        ? schedule.recurrenceType
        : 'daily';
    if (recurrenceType === 'once' && schedule.lastScheduledAt) {
      // A delivery was already reserved. Keep the schedule enabled until that
      // scheduled delivery succeeds (or an operator explicitly disables it).
      continue;
    }
    const nextRunAt = nextContentOccurrence({
      recurrenceType,
      onceAt: schedule.onceAt,
      weekdays: schedule.weekdays,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      after: now,
    });
    await prisma.dailyContent.update({
      where: { id: schedule.id },
      data: {
        nextRunAt,
        ...(recurrenceType === 'once' && !nextRunAt ? { enabled: false } : {}),
      },
    });
  }
}

async function recoverStale(
  prisma: DailyContentPrismaClient,
  now: Date,
  logger: Logger,
): Promise<void> {
  const minimumStaleBefore = new Date(now.getTime() - 2 * 60 * 1000);
  const stale = await listStaleDeliveries(prisma, minimumStaleBefore, DAILY_CONTENT_SCAN_LIMIT);
  for (const delivery of stale) {
    const config = await resolveGuildConfig(prisma as unknown as PrismaClient, delivery.guildId);
    const guildStaleBefore = now.getTime() - config.staleAfterMinutes * 60 * 1000;
    if (!delivery.startedAt || delivery.startedAt.getTime() >= guildStaleBefore) continue;
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
  if (error instanceof DailyContentForumPublishError) {
    return error.status === 429;
  }
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
