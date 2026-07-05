import { createLogger } from '@herta/logger';
import { Redis } from 'ioredis';

const logger = createLogger({
  name: 'herta-worker',
  level: process.env['WORKER_LOG_LEVEL'],
});

async function main() {
  logger.info('Herta Worker を起動しています...');

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  try {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
    await redis.connect();
    logger.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//<credentials>@') }, 'Redis 接続成功');
    await redis.quit();
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

process.on('SIGINT', () => {
  logger.info('Worker をシャットダウン中...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Worker をシャットダウン中...');
  process.exit(0);
});

main();
