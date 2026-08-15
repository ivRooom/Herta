import {
  finalizeCommunitySeasonSnapshot,
  listCommunitySeasonGuildIdsWithoutSnapshot,
  type PrismaClient,
} from '@herta/db';
import { communityLeaderboardSeasonStatus, listCommunityLeaderboardSeasons } from '@herta/shared';
import type { Logger } from 'pino';

const FINALIZER_INTERVAL_MS = 60 * 60 * 1000;
const FINALIZER_HISTORY_LIMIT = 12;
const FINALIZER_TARGET_LIMIT = 200;

export interface CommunitySeasonFinalizerSummary {
  scanned: number;
  finalized: number;
  alreadyFinalized: number;
  failed: number;
}

export interface CommunitySeasonRuntime {
  close(): Promise<void>;
}

export async function finalizeCompletedCommunitySeasons(
  options: { prisma: PrismaClient; logger: Logger },
  now = new Date(),
): Promise<CommunitySeasonFinalizerSummary> {
  const seasons = listCommunityLeaderboardSeasons(now, FINALIZER_HISTORY_LIMIT).filter(
    (season) => communityLeaderboardSeasonStatus(season, now) === 'completed',
  );
  const summary: CommunitySeasonFinalizerSummary = {
    scanned: 0,
    finalized: 0,
    alreadyFinalized: 0,
    failed: 0,
  };

  for (const season of seasons) {
    const remaining = FINALIZER_TARGET_LIMIT - summary.scanned;
    if (remaining <= 0) break;
    const guildIds = await listCommunitySeasonGuildIdsWithoutSnapshot(options.prisma, {
      seasonKey: season.key,
      seasonEndsAt: season.endsAt,
      limit: remaining,
    });

    for (const guildId of guildIds) {
      summary.scanned += 1;
      try {
        const result = await finalizeCommunitySeasonSnapshot(options.prisma, {
          guildId,
          season,
          now,
        });
        if (result.created) summary.finalized += 1;
        else summary.alreadyFinalized += 1;
      } catch (error) {
        summary.failed += 1;
        options.logger.warn(
          {
            guildId,
            seasonKey: season.key,
            errorName: resolveErrorName(error),
          },
          'Community Season Snapshotの確定に失敗しました',
        );
      }
    }
  }

  return summary;
}

export async function startCommunitySeasonRuntime(options: {
  prisma: PrismaClient;
  logger: Logger;
}): Promise<CommunitySeasonRuntime> {
  let closed = false;
  let running = false;

  const run = async (): Promise<void> => {
    if (closed || running) return;
    running = true;
    try {
      const summary = await finalizeCompletedCommunitySeasons(options);
      if (summary.scanned > 0 || summary.failed > 0) {
        options.logger.info(summary, 'Community Season Snapshotの確定チェックを完了しました');
      }
    } catch (error) {
      options.logger.error(
        { errorName: resolveErrorName(error) },
        'Community Season Snapshotの確定チェックに失敗しました',
      );
    } finally {
      running = false;
    }
  };

  await run();
  const timer = setInterval(() => {
    void run();
  }, FINALIZER_INTERVAL_MS);
  timer.unref();

  return {
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
    },
  };
}

function resolveErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error.name.trim() && error.name !== 'Error') return error.name.slice(0, 120);
  return (error.message.trim() || 'Error').slice(0, 120);
}
