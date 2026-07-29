import type { PrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  buildTeamSplitDiscordMessage,
  createTeamSplitMessageNonce,
  expireTeamSplitSession,
  listTeamSplitParticipants,
  markTeamSplitMessageMissing,
  markTeamSplitMessageSynchronized,
  normalizeTeamSplitConfig,
  updateTeamSplitMessageReference,
  type TeamSplitPrismaClient,
  type TeamSplitSessionRecord,
} from '@herta/plugin-catalog/team-split-service';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);
const DEFAULT_SCAN_INTERVAL_SECONDS = 30;
const RECOVERY_RETRY_DELAY_MS = 60_000;
const SCAN_LIMIT = 100;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const SHUTDOWN_WAIT_MS = 10_000;

export interface TeamSplitWorkerRuntime {
  close(): Promise<void>;
}

export interface StartTeamSplitRuntimeOptions {
  prisma: PrismaClient;
  logger: Logger;
  discordBotToken: string;
  secret: string;
}

interface DiscordChannelPayload {
  type?: number;
  guild_id?: string;
}

export async function startTeamSplitRuntime(
  options: StartTeamSplitRuntimeOptions,
): Promise<TeamSplitWorkerRuntime> {
  assertSecret(options.secret);
  let scanning = false;
  let lastPrunedAt = 0;
  let timer: NodeJS.Timeout | undefined;
  let scanAbortController: AbortController | undefined;

  const scanNow = async () => {
    if (scanning) return;
    scanning = true;
    scanAbortController = new AbortController();
    try {
      await expireDueSessions(options);
      await synchronizePendingMessages(options, scanAbortController.signal);
      await recoverMissingMessages(options, scanAbortController.signal);
      if (Date.now() - lastPrunedAt >= PRUNE_INTERVAL_MS) {
        await pruneEndedSessions(options);
        lastPrunedAt = Date.now();
      }
    } catch (error) {
      if (!scanAbortController.signal.aborted) {
        options.logger.error(
          { errorName: resolveErrorName(error) },
          'Team Split Workerの走査に失敗しました',
        );
      }
    } finally {
      scanning = false;
      scanAbortController = undefined;
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
      scanAbortController?.abort();
      const deadline = Date.now() + SHUTDOWN_WAIT_MS;
      while (scanning && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function expireDueSessions(options: StartTeamSplitRuntimeOptions): Promise<void> {
  const prisma = options.prisma as unknown as TeamSplitPrismaClient;
  const enabledGuildIds = await listEnabledGuildIds(options.prisma);
  if (enabledGuildIds.length === 0) return;
  const now = new Date();
  const sessions = await options.prisma.teamSplitSession.findMany({
    where: {
      guildId: { in: enabledGuildIds },
      status: { in: ['open', 'split'] },
      expiresAt: { lte: now },
      deletedAt: null,
    },
    orderBy: { expiresAt: 'asc' },
    take: SCAN_LIMIT,
  });
  for (const due of sessions) {
    const expired = await expireTeamSplitSession(prisma, {
      guildId: due.guildId,
      sessionId: due.id,
      now,
    });
    if (!expired) continue;
    options.logger.info(
      { guildId: expired.guildId, sessionId: expired.id },
      'Team Splitセッションを期限切れにしました',
    );
  }
}

async function synchronizePendingMessages(
  options: StartTeamSplitRuntimeOptions,
  signal: AbortSignal,
): Promise<void> {
  const enabledGuildIds = await listEnabledGuildIds(options.prisma);
  if (enabledGuildIds.length === 0) return;
  const retryBefore = new Date(Date.now() - RECOVERY_RETRY_DELAY_MS);
  const sessions = await options.prisma.teamSplitSession.findMany({
    where: {
      guildId: { in: enabledGuildIds },
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

  for (const session of sessions) {
    if (signal.aborted) return;
    const prisma = options.prisma as unknown as TeamSplitPrismaClient;
    try {
      await updateDiscordMessage(options, session as TeamSplitSessionRecord, signal);
      await markTeamSplitMessageSynchronized(prisma, {
        guildId: session.guildId,
        sessionId: session.id,
        expectedVersion: session.version,
      });
    } catch (error) {
      if (signal.aborted) return;
      await recordMessageFailure(options.prisma, session as TeamSplitSessionRecord, error);
    }
  }
}

async function recoverMissingMessages(
  options: StartTeamSplitRuntimeOptions,
  signal: AbortSignal,
): Promise<void> {
  const enabledGuildIds = await listEnabledGuildIds(options.prisma);
  if (enabledGuildIds.length === 0) return;
  const retryBefore = new Date(Date.now() - RECOVERY_RETRY_DELAY_MS);
  const sessions = await options.prisma.teamSplitSession.findMany({
    where: {
      guildId: { in: enabledGuildIds },
      status: { in: ['open', 'split'] },
      messageId: null,
      deletedAt: null,
      OR: [
        { messageState: 'missing' },
        { messageState: 'pending', updatedAt: { lte: retryBefore } },
        { messageState: 'failed', updatedAt: { lte: retryBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: SCAN_LIMIT,
  });

  for (const session of sessions) {
    if (signal.aborted) return;
    const prisma = options.prisma as unknown as TeamSplitPrismaClient;
    try {
      const record = session as TeamSplitSessionRecord;
      const messageId = await createDiscordMessage(options, record, signal);
      const linked = await updateTeamSplitMessageReference(prisma, {
        guildId: record.guildId,
        sessionId: record.id,
        messageId,
        actorId: 'system',
        expectedVersion: record.version,
      });
      if (!linked || linked.messageId !== messageId) {
        await deleteDiscordMessage(options, record.channelId, messageId, signal).catch((error) => {
          options.logger.warn(
            {
              guildId: record.guildId,
              sessionId: record.id,
              errorName: resolveErrorName(error),
            },
            'version競合後のTeam Splitメッセージ削除に失敗しました',
          );
        });
        continue;
      }
      options.logger.info(
        { guildId: record.guildId, sessionId: record.id },
        'Team Splitメッセージを復旧しました',
      );
    } catch (error) {
      if (signal.aborted) return;
      await recordMessageFailure(options.prisma, session as TeamSplitSessionRecord, error);
    }
  }
}

async function listEnabledGuildIds(prisma: PrismaClient): Promise<string[]> {
  const plugins = await prisma.guildPlugin.findMany({
    where: { pluginId: 'team-split', enabled: true },
    select: { guildId: true },
  });
  return plugins.map((plugin) => plugin.guildId);
}

async function pruneEndedSessions(options: StartTeamSplitRuntimeOptions): Promise<void> {
  const plugins = await options.prisma.guildPlugin.findMany({
    where: { pluginId: 'team-split' },
    select: { guildId: true, config: true },
  });
  const now = new Date();
  for (const plugin of plugins) {
    const config = normalizeTeamSplitConfig(plugin.config);
    const before = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);
    const result = await options.prisma.teamSplitSession.updateMany({
      where: {
        guildId: plugin.guildId,
        status: { in: ['closed', 'expired'] },
        deletedAt: null,
        OR: [{ closedAt: { lte: before } }, { closedAt: null, updatedAt: { lte: before } }],
      },
      data: { deletedAt: now },
    });
    if (result.count > 0) {
      options.logger.info(
        { guildId: plugin.guildId, count: result.count },
        '保持期間を超えたTeam SplitセッションをSoft Deleteしました',
      );
    }
  }
}

async function createDiscordMessage(
  options: StartTeamSplitRuntimeOptions,
  session: TeamSplitSessionRecord,
  signal: AbortSignal,
): Promise<string> {
  await assertTextChannel(options.discordBotToken, session.channelId, session.guildId, signal);
  const participants = await listTeamSplitParticipants(
    options.prisma as unknown as TeamSplitPrismaClient,
    session.guildId,
    session.id,
  );
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${session.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${options.discordBotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...buildTeamSplitDiscordMessage(session, participants, options.secret),
      nonce: createTeamSplitMessageNonce(session.id, session.version),
      enforce_nonce: true,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) {
    throw new TeamSplitDiscordError('TeamSplitDiscordCreateMessageFailed', response.status);
  }
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== 'string' || !message.id) {
    throw new TeamSplitDiscordError('TeamSplitDiscordMessageResponseInvalid', response.status);
  }
  return message.id;
}

async function updateDiscordMessage(
  options: StartTeamSplitRuntimeOptions,
  session: TeamSplitSessionRecord,
  signal: AbortSignal,
): Promise<void> {
  if (!session.messageId) return;
  await assertTextChannel(options.discordBotToken, session.channelId, session.guildId, signal);
  const participants = await listTeamSplitParticipants(
    options.prisma as unknown as TeamSplitPrismaClient,
    session.guildId,
    session.id,
  );
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/channels/${session.channelId}/messages/${session.messageId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${options.discordBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildTeamSplitDiscordMessage(session, participants, options.secret)),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  if (!response.ok) {
    throw new TeamSplitDiscordError('TeamSplitDiscordUpdateMessageFailed', response.status);
  }
}

async function deleteDiscordMessage(
  options: StartTeamSplitRuntimeOptions,
  channelId: string,
  messageId: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bot ${options.discordBotToken}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new TeamSplitDiscordError('TeamSplitDiscordDeleteMessageFailed', response.status);
  }
}

async function assertTextChannel(
  token: string,
  channelId: string,
  expectedGuildId: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) {
    throw new TeamSplitDiscordError('TeamSplitDiscordChannelPreflightFailed', response.status);
  }
  const channel = (await response.json()) as DiscordChannelPayload;
  if (channel.guild_id !== expectedGuildId) {
    throw new TeamSplitDiscordError('TeamSplitDiscordChannelGuildMismatch', 403);
  }
  if (typeof channel.type !== 'number' || !TEXT_CHANNEL_TYPES.has(channel.type)) {
    throw new TeamSplitDiscordError('TeamSplitDiscordChannelNotTextBased', response.status);
  }
}

async function recordMessageFailure(
  prisma: PrismaClient,
  session: TeamSplitSessionRecord,
  error: unknown,
): Promise<void> {
  if (
    error instanceof TeamSplitDiscordError &&
    error.httpStatus === 404 &&
    (session.status === 'open' || session.status === 'split') &&
    session.messageId
  ) {
    await markTeamSplitMessageMissing(prisma as unknown as TeamSplitPrismaClient, {
      guildId: session.guildId,
      messageId: session.messageId,
      errorName: error.name,
    });
    return;
  }
  await prisma.teamSplitSession.update({
    where: { id: session.id },
    data: { messageState: 'failed', lastErrorName: resolveErrorName(error) },
  });
}

class TeamSplitDiscordError extends Error {
  constructor(
    name: string,
    readonly httpStatus: number,
  ) {
    super(name);
    this.name = name;
  }
}

function resolveScanIntervalSeconds(): number {
  const parsed = Number.parseInt(process.env['TEAM_SPLIT_SCAN_INTERVAL_SECONDS'] ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCAN_INTERVAL_SECONDS;
  return Math.min(300, Math.max(10, parsed));
}

function assertSecret(secret: string): void {
  if (secret.length < 32) throw new Error('TEAM_SPLIT_SECRETは32文字以上で設定してください');
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name.slice(0, 120);
  return 'UnknownError';
}
