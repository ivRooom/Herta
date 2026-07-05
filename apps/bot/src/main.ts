import { createLogger } from '@herta/logger';
import { HertaBot } from './bot.js';

const logger = createLogger({ name: 'herta-bot' });

const bot = new HertaBot(logger);

async function main() {
  try {
    await bot.start();
  } catch (error) {
    logger.fatal(error, 'Bot の起動に失敗しました');
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.info('シャットダウン中...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('シャットダウン中...');
  await bot.stop();
  process.exit(0);
});

main();
