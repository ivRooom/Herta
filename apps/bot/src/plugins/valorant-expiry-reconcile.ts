import { RESTJSONErrorCodes, type Client } from 'discord.js';
import type { PrismaClient } from '@herta/db';
import { buildValorantSessionMessage } from './valorant.js';
import { getValorantSession, type ValorantSessionSnapshot } from './valorant-session-repository.js';

const MAX_BATCH = 20;
const MAX_RETRY_MS = 60 * 60 * 1000;
const START_RETRY_MS = 60 * 1000;

export type ValorantExpirySyncResult = 'updated' | 'gone';
export interface ValorantExpirySyncStats {
  attempted: number;
  updated: number;
  gone: number;
  retried: number;
}

function retryDelayMs(failures: number): number {
  return Math.min(MAX_RETRY_MS, START_RETRY_MS * 2 ** Math.min(Math.max(failures - 1, 0), 6));
}

/**
 * Reconcile Discord public messages only AFTER the DB clock has expired.
 * This is a bounded, sequential, DB-backed worker: a Bot restart cannot forget
 * pending work and a broken channel cannot starve later sessions.
 *
 * Do not use Bot memory or message appearance as the source of truth.
 */
export async function reconcileExpiredValorantMessages(
  prisma: PrismaClient,
  options: {
    guildIds: readonly string[];
    edit: (session: ValorantSessionSnapshot) => Promise<ValorantExpirySyncResult>;
    now?: Date;
    batchSize?: number;
    onRetry?: (reason: string, count: number) => void;
  },
): Promise<ValorantExpirySyncStats> {
  const stats: ValorantExpirySyncStats = { attempted: 0, updated: 0, gone: 0, retried: 0 };
  const guildIds = [...new Set(options.guildIds)];
  if (!guildIds.length) return stats;
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(MAX_BATCH, options.batchSize ?? 10));
  const rows = await prisma.valorantPickSession.findMany({
    where: {
      guildId: { in: guildIds },
      messageId: { not: null },
      status: { in: ['OPEN', 'EXPIRED', 'COMPLETED'] },
      expiresAt: { lte: now },
      expiryUiSyncedAt: null,
      OR: [{ expiryUiRetryAt: null }, { expiryUiRetryAt: { lte: now } }],
    },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
  });

  for (const row of rows) {
    if (!row.messageId) continue;
    // Expire using a status/time CAS. A concurrent successful draw/cancel
    // never gets overwritten by this sweep.
    if (row.status === 'OPEN') {
      await prisma.valorantPickSession.updateMany({
        where: { id: row.id, guildId: row.guildId, status: 'OPEN', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
    }
    // Guild-scoped re-read immediately before touching Discord. A reroll may
    // transfer messageId to a new history row; that old row must not edit it.
    const current = await getValorantSession(prisma, row.guildId, row.id);
    if (
      !current ||
      !current.messageId ||
      current.messageId !== row.messageId ||
      !['EXPIRED', 'COMPLETED'].includes(current.status) ||
      current.expiresAt > now ||
      current.expiryUiSyncedAt !== null
    ) {
      continue;
    }

    stats.attempted++;
    try {
      const outcome = await options.edit(current);
      await prisma.valorantPickSession.updateMany({
        where: {
          id: row.id,
          guildId: row.guildId,
          messageId: row.messageId,
          expiryUiSyncedAt: null,
        },
        data: {
          expiryUiSyncedAt: now,
          expiryUiRetryAt: null,
          expiryUiRetryCount: 0,
        },
      });
      if (outcome === 'gone') stats.gone++;
      else stats.updated++;
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownError';
      const failures = Math.min(20, current.expiryUiRetryCount + 1);
      const delayMs = retryDelayMs(failures);
      await prisma.valorantPickSession.updateMany({
        where: {
          id: row.id,
          guildId: row.guildId,
          messageId: row.messageId,
          expiryUiSyncedAt: null,
        },
        data: {
          expiryUiRetryCount: failures,
          expiryUiRetryAt: new Date(now.getTime() + delayMs),
        },
      });
      stats.retried++;
      options.onRetry?.(reason, failures);
    }
  }
  return stats;
}

/**
 * Preserve a completed draw's rich image and attachments. Only disable the
 * expired reroll button. A recruitment Embed has no result image, so it can
 * be replaced with the canonical EXPIRED state and disabled controls.
 */
export async function editExpiredValorantDiscordMessage(
  client: Client,
  session: ValorantSessionSnapshot,
): Promise<ValorantExpirySyncResult> {
  if (!session.messageId) return 'gone';
  const guild = client.guilds.cache.get(session.guildId);
  if (!guild) throw new Error('GuildUnavailable');
  try {
    const channel = await guild.channels.fetch(session.channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return 'gone';
    const message = await channel.messages.fetch(session.messageId);
    if (session.status === 'COMPLETED') {
      // Do not wipe the Cinematic PNG/other rich result attachments.
      await message.edit({ components: buildValorantSessionMessage(session).components });
    } else {
      await message.edit({ ...buildValorantSessionMessage(session), attachments: [] });
    }
    return 'updated';
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === RESTJSONErrorCodes.UnknownMessage ||
        error.code === RESTJSONErrorCodes.UnknownChannel)
    ) {
      return 'gone';
    }
    throw error;
  }
}
