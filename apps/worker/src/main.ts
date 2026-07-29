import { getPrismaClient } from '@herta/db';
import { createLogger } from '@herta/logger';
import { HERTA_WORKER_HEARTBEAT_INTERVAL_MS, HERTA_WORKER_HEARTBEAT_KEY } from '@herta/shared';
import { Redis } from 'ioredis';
import { startDailyContentRuntime, type DailyContentRuntime } from './daily-content.js';

const logger = createLogger({
  name: 'herta-worker',
  level: process.env['WORKER_LOG_LEVEL'],
});

let redis: Redis | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let dailyContentRuntime: DailyContentRuntime | undefined;
let shuttingDown = false;

function resolveHeartbeatTtlMs(): number {
  const configured = Number.parseInt(process.env['HEALTH_HEARTBEAT_STALE_MS'] ?? '', 10);
  const staleMs = Number.isFinite(configured) && configured >= 5_000 ? configured : 120_000;
  return Math.max(staleMs * 3, 300_000);
}

async function writeHeartbeat(): Promise<void> {
  if (!redis) return;
  await redis.set(
    HERTA_WORKER_HEARTBEAT_KEY,
    new Date().toISOString(),
    'PX',
    resolveHeartbeatTtlMs(),
  );
}

async function main() {
  logger.info('Herta Worker を起動しています...');

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  try {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', () => {
      logger.error('Redis エラー');
    });
    redis.on('ready', () => {
      logger.info('Redis 接続準備完了');
    });
    await redis.connect();
    logger.info('Redis 接続成功');
    await writeHeartbeat();
    heartbeatTimer = setInterval(() => {
      void writeHeartbeat().catch(() => {
        logger.warn('Worker heartbeat の更新に失敗しました');
      });
    }, HERTA_WORKER_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
  } catch (error) {
    logger.error(
      { errorName: resolveErrorName(error) },
      'Redis 接続に失敗しました。REDIS_URL を確認してください。docker compose up -d で Redis を起動できます',
    );
    process.exit(1);
  }

  const discordBotToken = process.env['DISCORD_BOT_TOKEN']?.trim();
  if (!process.env['DATABASE_URL']) {
    logger.warn('DATABASE_URLが未設定のためDaily Content Workerを開始しません');
  } else if (!discordBotToken) {
    logger.warn('DISCORD_BOT_TOKENが未設定のためDaily Content Workerを開始しません');
  } else {
    try {
      dailyContentRuntime = await startDailyContentRuntime({
        redisUrl,
        prisma: getPrismaClient(),
        logger,
        discordBotToken,
      });
      logger.info('Daily Content Workerを開始しました');
    } catch (error) {
      logger.error(
        { errorName: resolveErrorName(error) },
        'Daily Content Workerの開始に失敗しました',
      );
      process.exit(1);
    }
  }

  logger.info('Herta Worker を起動しました');
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker をシャットダウン中...');

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  try {
    await dailyContentRuntime?.close();
    dailyContentRuntime = undefined;
  } catch (error) {
    logger.error(
      { errorName: resolveErrorName(error) },
      'Daily Content Workerの終了処理に失敗しました',
    );
  }

  try {
    await redis?.del(HERTA_WORKER_HEARTBEAT_KEY);
    await redis?.quit();
  } catch (error) {
    logger.error({ errorName: resolveErrorName(error) }, 'Redis の終了処理に失敗しました');
  }

  process.exit(0);
}

function resolveErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error.name.trim() && error.name !== 'Error') return error.name.slice(0, 120);
  return (error.message.trim() || 'Error').slice(0, 120);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void main();
