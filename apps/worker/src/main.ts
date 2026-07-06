import { createLogger } from '@herta/logger';
import { Redis } from 'ioredis';

const logger = createLogger({
  name: 'herta-worker',
  level: process.env['WORKER_LOG_LEVEL'],
});

let redis: Redis | undefined;
let shuttingDown = false;

async function main() {
  logger.info('Herta Worker を起動しています...');

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  try {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', (error) => {
      logger.error({ err: error }, 'Redis エラー');
    });
    redis.on('ready', () => {
      logger.info(
        { redisUrl: redisUrl.replace(/\/\/.*@/, '//<credentials>@') },
        'Redis 接続準備完了',
      );
    });
    await redis.connect();
    logger.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//<credentials>@') }, 'Redis 接続成功');
  } catch (error) {
    logger.error(
      { redisUrl, err: error },
      'Redis 接続に失敗しました。REDIS_URL を確認してください。docker compose up -d で Redis を起動できます',
    );
    process.exit(1);
  }

  logger.info('Herta Worker を起動しました');

  // BullMQ Worker の登録は Phase 5 以降で実装
  // 以下のジョブを処理する:
  // - scheduled: Plugin のスケジュール実行
  // - cleanup: 古いログの削除
  // - notification: 通知送信
  // - analytics: 集計処理
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Worker をシャットダウン中...');

  try {
    await redis?.quit();
  } catch (error) {
    logger.error({ err: error }, 'Redis の終了処理に失敗しました');
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

main();
