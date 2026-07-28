import { getPrismaClient, pruneCommandExecutionEvents } from '@herta/db';
import {
  pruneAutoResponseExecutionEvents,
  type AutoResponsePrismaClient,
} from '@herta/plugin-catalog/auto-response-service';
import { createLogger } from '@herta/logger';
import { HertaBot } from './bot.js';
import { loadHealthConfig } from './health/config.js';
import { HealthHttpServer } from './health/server.js';
import { HertaHealthService } from './health/service.js';

const logger = createLogger({
  name: 'herta-bot',
  level: process.env['BOT_LOG_LEVEL'],
});

const healthConfig = loadHealthConfig();
const bot = new HertaBot(logger, healthConfig.heartbeatStaleMs);
const version = process.env['HERTA_VERSION']?.trim() || '0.1.0';
const healthService = new HertaHealthService({
  config: healthConfig,
  logger,
  version,
  probes: {
    discord: () => bot.getDiscordHealthObservation(),
    guildCount: () => bot.getGuildCount(),
    ...(process.env['DATABASE_URL'] ? { database: () => bot.probeDatabase() } : {}),
    ...(process.env['REDIS_URL']
      ? {
          redis: () => bot.probeRedis(),
          workerHeartbeat: () => bot.getWorkerHeartbeat(),
        }
      : {}),
  },
});
const healthServer = healthConfig.enabled
  ? new HealthHttpServer({
      config: healthConfig,
      logger,
      version,
      getHealth: () => healthService.getHealth(),
    })
  : undefined;

const EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

let shuttingDown = false;
let executionAnalyticsPruneInFlight = false;
let executionAnalyticsPruneTimer: NodeJS.Timeout | undefined;

async function pruneExecutionAnalytics(): Promise<void> {
  if (!process.env['DATABASE_URL'] || executionAnalyticsPruneInFlight) return;

  executionAnalyticsPruneInFlight = true;
  try {
    const prisma = getPrismaClient();
    const [commandDeleted, autoResponseDeleted] = await Promise.all([
      pruneCommandExecutionEvents(prisma),
      pruneAutoResponseExecutionEvents(prisma as unknown as AutoResponsePrismaClient),
    ]);
    if (commandDeleted > 0) {
      logger.info(
        { deleted: commandDeleted, retentionDays: 90 },
        '古いコマンド実行履歴を削除しました',
      );
    }
    if (autoResponseDeleted > 0) {
      logger.info(
        { deleted: autoResponseDeleted, retentionDays: 90 },
        '古いAuto Response実行履歴を削除しました',
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '古い実行履歴の整理に失敗しました');
  } finally {
    executionAnalyticsPruneInFlight = false;
  }
}

function startExecutionAnalyticsPruning(): void {
  if (!process.env['DATABASE_URL'] || executionAnalyticsPruneTimer) return;

  executionAnalyticsPruneTimer = setInterval(() => {
    void pruneExecutionAnalytics();
  }, EXECUTION_ANALYTICS_PRUNE_INTERVAL_MS);
  executionAnalyticsPruneTimer.unref();
}

function stopExecutionAnalyticsPruning(): void {
  if (!executionAnalyticsPruneTimer) return;
  clearInterval(executionAnalyticsPruneTimer);
  executionAnalyticsPruneTimer = undefined;
}

async function main(): Promise<void> {
  logger.info('Herta Bot を起動しています...');
  try {
    await pruneExecutionAnalytics();
    await healthServer?.start();
    await bot.start();
    startExecutionAnalyticsPruning();
  } catch (error) {
    stopExecutionAnalyticsPruning();
    await healthServer?.stop().catch(() => undefined);
    logger.fatal(error, 'Bot の起動に失敗しました');
    process.exitCode = 1;
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopExecutionAnalyticsPruning();
  logger.info({ signal }, 'シャットダウン中...');

  const results = await Promise.allSettled([healthServer?.stop(), bot.stop()]);
  const rejected = results.filter((result) => result.status === 'rejected').length;
  if (rejected > 0) {
    logger.error({ rejected }, 'シャットダウン処理の一部が失敗しました');
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void main();
