import { createLogger } from '@herta/logger';

const logger = createLogger({ name: 'herta-worker' });

async function main() {
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
