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

let shuttingDown = false;

async function main(): Promise<void> {
  logger.info('Herta Bot を起動しています...');
  try {
    await healthServer?.start();
    await bot.start();
  } catch (error) {
    await healthServer?.stop().catch(() => undefined);
    logger.fatal(error, 'Bot の起動に失敗しました');
    process.exitCode = 1;
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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
