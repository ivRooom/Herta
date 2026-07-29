import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  buildLfgDiscordMessage,
  expireLfgPost,
  isLfgPluginEnabled,
  listDueLfgPosts,
  normalizeLfgConfig,
  listLfgParticipants,
  markLfgMessageMissing,
  markLfgMessageSynchronized,
  updateLfgMessageReference,
  type LfgPostRecord,
  type LfgPrismaClient,
} from '@herta/plugin-catalog/lfg-service';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);
const DEFAULT_SCAN_INTERVAL_SECONDS = 30;
const RECOVERY_RETRY_DELAY_MS = 60_000;
const SCAN_LIMIT = 100;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface LfgRuntime {
  close(): Promise<void>;
}

export interface StartLfgRuntimeOptions {
  prisma: PrismaClient;
  logger: Logger;
  discordBotToken: string;
  componentSecret: string;
}

interface DiscordChannelPayload {
  id?: string;
  type?: number;
}

export async function startLfgRuntime(options: StartLfgRuntimeOptions): Promise<LfgRuntime> {
  assertSecret(options.componentSecret);
  let scanning = false;
  let lastPrunedAt = 0;
  let timer: NodeJS.Timeout | undefined;

  const scanNow = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await expireDuePosts(options);
      await synchronizePendingMessages(options);
      await recoverMissingMessages(options);
      if (Date.now() - lastPrunedAt >= PRUNE_INTERVAL_MS) {
        await pruneEndedPosts(options);
        lastPrunedAt = Date.now();
      }
    } catch (error) {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'LFG Workerの走査に失敗しました',
      );
    } finally {
      scanning = false;
    }
  };

  await scanNow();
  timer = setInterval(() => {
    void scanNow();
  }, resolveScanIntervalSeconds() * 1000);
  timer.unref();

  return {
    async close() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      while (scanning) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function expireDuePosts(options: StartLfgRuntimeOptions): Promise<void> {
  const prisma = options.prisma as unknown as LfgPrismaClient;
  const now = new Date();
  const duePosts = await listDueLfgPosts(prisma, now, SCAN_LIMIT);
  for (const due of duePosts) {
    const pluginEnabled = await isLfgPluginEnabled(prisma, due.guildId);
    if (!pluginEnabled) continue;
    const expired = await expireLfgPost(prisma, {
      guildId: due.guildId,
      postId: due.id,
      now,
    });
    if (!expired) continue;
    options.logger.info(
      { guildId: expired.guildId, postId: expired.id },
      'LFG募集を期限切れにしました',
    );
  }
}

async function synchronizePendingMessages(options: StartLfgRuntimeOptions): Promise<void> {
  const retryBefore = new Date(Date.now() - RECOVERY_RETRY_DELAY_MS);
  const posts = await options.prisma.lfgPost.findMany({
    where: {
      messageId: { not: null },
      deletedAt: null,
      OR: [
        { messageState: 'pending' },
        { messageState: 'failed', updatedAt: { lte: retryBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: SCAN_LIMIT,
  });

  for (const post of posts) {
    const pluginEnabled = await isLfgPluginEnabled(
      options.prisma as unknown as LfgPrismaClient,
      post.guildId,
    );
    if (!pluginEnabled) continue;
    try {
      await updateDiscordMessage(options, post as LfgPostRecord);
      await markLfgMessageSynchronized(options.prisma as unknown as LfgPrismaClient, {
        guildId: post.guildId,
        postId: post.id,
        expectedVersion: post.version,
      });
    } catch (error) {
      await recordMessageFailure(options.prisma, post as LfgPostRecord, error);
    }
  }
}

async function recoverMissingMessages(options: StartLfgRuntimeOptions): Promise<void> {
  const retryBefore = new Date(Date.now() - RECOVERY_RETRY_DELAY_MS);
  const posts = await options.prisma.lfgPost.findMany({
    where: {
      status: { in: ['open', 'full'] },
      messageId: null,
      deletedAt: null,
      OR: [
        { messageState: { in: ['pending', 'missing'] } },
        { messageState: 'failed', updatedAt: { lte: retryBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: SCAN_LIMIT,
  });

  for (const post of posts) {
    const pluginEnabled = await isLfgPluginEnabled(
      options.prisma as unknown as LfgPrismaClient,
      post.guildId,
    );
    if (!pluginEnabled) continue;

    try {
      const messageId = await createDiscordMessage(options, post as LfgPostRecord);
      await updateLfgMessageReference(options.prisma as unknown as LfgPrismaClient, {
        guildId: post.guildId,
        postId: post.id,
        messageId,
        actorId: 'system',
        expectedVersion: post.version,
      });
      options.logger.info(
        { guildId: post.guildId, postId: post.id },
        'LFG募集メッセージを復旧しました',
      );
    } catch (error) {
      await recordMessageFailure(options.prisma, post as LfgPostRecord, error);
    }
  }
}

async function pruneEndedPosts(options: StartLfgRuntimeOptions): Promise<void> {
  const plugins = await options.prisma.guildPlugin.findMany({
    where: { pluginId: 'lfg' },
    select: { guildId: true, config: true },
  });
  const now = new Date();
  for (const plugin of plugins) {
    const config = normalizeLfgConfig(plugin.config);
    const before = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);
    const result = await options.prisma.lfgPost.updateMany({
      where: {
        guildId: plugin.guildId,
        status: { in: ['closed', 'cancelled', 'expired'] },
        deletedAt: null,
        OR: [{ closedAt: { lte: before } }, { closedAt: null, updatedAt: { lte: before } }],
      },
      data: { deletedAt: now },
    });
    if (result.count > 0) {
      options.logger.info(
        { guildId: plugin.guildId, count: result.count },
        '保持期間を超えたLFG募集をSoft Deleteしました',
      );
    }
  }
}

async function createDiscordMessage(
  options: StartLfgRuntimeOptions,
  post: LfgPostRecord,
): Promise<string> {
  await assertTextChannel(options.discordBotToken, post.channelId);
  const participantIds = await getParticipantIds(options.prisma, post);
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${post.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${options.discordBotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildLfgDiscordMessage(post, participantIds, options.componentSecret)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new LfgDiscordError('LfgDiscordCreateMessageFailed', response.status);
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !message.id) {
    throw new LfgDiscordError('LfgDiscordMessageResponseInvalid', response.status);
  }
  return message.id;
}

async function updateDiscordMessage(
  options: StartLfgRuntimeOptions,
  post: LfgPostRecord,
): Promise<void> {
  if (!post.messageId) return;
  await assertTextChannel(options.discordBotToken, post.channelId);
  const participantIds = await getParticipantIds(options.prisma, post);
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/channels/${post.channelId}/messages/${post.messageId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${options.discordBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildLfgDiscordMessage(post, participantIds, options.componentSecret)),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new LfgDiscordError('LfgDiscordUpdateMessageFailed', response.status);
}

async function getParticipantIds(prisma: PrismaClient, post: LfgPostRecord): Promise<string[]> {
  const participants = await listLfgParticipants(
    prisma as unknown as LfgPrismaClient,
    post.guildId,
    post.id,
  );
  return participants.map((participant) => participant.userId);
}

async function assertTextChannel(token: string, channelId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new LfgDiscordError('LfgDiscordChannelPreflightFailed', response.status);
  const channel = (await response.json()) as DiscordChannelPayload;
  if (typeof channel.type !== 'number' || !TEXT_CHANNEL_TYPES.has(channel.type)) {
    throw new LfgDiscordError('LfgDiscordChannelNotTextBased', response.status);
  }
}

async function recordMessageFailure(
  prisma: PrismaClient,
  post: LfgPostRecord,
  error: unknown,
): Promise<void> {
  if (
    error instanceof LfgDiscordError &&
    error.httpStatus === 404 &&
    (post.status === 'open' || post.status === 'full') &&
    post.messageId
  ) {
    await markLfgMessageMissing(prisma as unknown as LfgPrismaClient, {
      guildId: post.guildId,
      messageId: post.messageId,
      errorName: error.name,
    });
    return;
  }
  await prisma.lfgPost.update({
    where: { id: post.id },
    data: {
      messageState: 'failed',
      lastErrorName: resolveErrorName(error),
    },
  });
}

class LfgDiscordError extends Error {
  constructor(
    name: string,
    readonly httpStatus: number,
  ) {
    super(name);
    this.name = name;
  }
}

function resolveScanIntervalSeconds(): number {
  const parsed = Number.parseInt(process.env['LFG_SCAN_INTERVAL_SECONDS'] ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_INTERVAL_SECONDS;
  return Math.min(300, Math.max(10, parsed));
}

function assertSecret(secret: string): void {
  if (secret.length < 32) throw new Error('LFG_COMPONENT_SECRETは32文字以上で指定してください');
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name.slice(0, 120);
  return 'UnknownError';
}
