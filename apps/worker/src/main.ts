import { getPrismaClient } from '@herta/db';
import { createLogger } from '@herta/logger';
import { HERTA_WORKER_HEARTBEAT_INTERVAL_MS, HERTA_WORKER_HEARTBEAT_KEY } from '@herta/shared';
import { Redis } from 'ioredis';
import { startCommunitySeasonRuntime, type CommunitySeasonRuntime } from './community-seasons.js';
import { startDailyContentRuntime, type DailyContentRuntime } from './daily-content.js';
import {
  startDiscordRoleOperationRuntime,
  type DiscordRoleOperationRuntime,
} from './discord-role-operations.js';
import { startLfgRuntime, type LfgRuntime } from './lfg.js';
import { startTeamSplitRuntime, type TeamSplitWorkerRuntime } from './team-split.js';

const logger = createLogger({
  name: 'herta-worker',
  level: process.env['WORKER_LOG_LEVEL'],
});

let redis: Redis | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let communitySeasonRuntime: CommunitySeasonRuntime | undefined;
let dailyContentRuntime: DailyContentRuntime | undefined;
let discordRoleOperationRuntime: DiscordRoleOperationRuntime | undefined;
let lfgRuntime: LfgRuntime | undefined;
let teamSplitRuntime: TeamSplitWorkerRuntime | undefined;
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
  const databaseConfigured = Boolean(process.env['DATABASE_URL']);
  if (!databaseConfigured) {
    logger.warn('DATABASE_URLが未設定のためPlugin WorkerとSeason Snapshot Workerを開始しません');
  } else {
    try {
      communitySeasonRuntime = await startCommunitySeasonRuntime({
        prisma: getPrismaClient(),
        logger,
      });
      logger.info('Community Season Snapshot Workerを開始しました');
    } catch (error) {
      logger.error(
        { errorName: resolveErrorName(error) },
        'Community Season Snapshot Workerの開始に失敗しました',
      );
      process.exit(1);
    }

    const botHealthUrl = process.env['BOT_HEALTH_URL']?.trim();
    const botInternalApiSecret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
    if (!botHealthUrl || !botInternalApiSecret || botInternalApiSecret.length < 32) {
      logger.warn(
        'BOT_HEALTH_URLまたはBOT_INTERNAL_API_SECRETが未設定のためDiscord Role Operation Workerを開始しません',
      );
    } else {
      try {
        const configuredInterval = Number.parseInt(
          process.env['DISCORD_ROLE_OPERATION_SCAN_INTERVAL_SECONDS'] ?? '',
          10,
        );
        discordRoleOperationRuntime = await startDiscordRoleOperationRuntime({
          prisma: getPrismaClient(),
          logger,
          botHealthUrl,
          internalApiSecret: botInternalApiSecret,
          scanIntervalSeconds: Number.isFinite(configuredInterval) ? configuredInterval : undefined,
        });
        logger.info('Discord Role Operation Workerを開始しました');
      } catch (error) {
        logger.error(
          { errorName: resolveErrorName(error) },
          'Discord Role Operation Workerの開始に失敗しました',
        );
        process.exit(1);
      }
    }

    if (!discordBotToken) {
      logger.warn('DISCORD_BOT_TOKENが未設定のためDiscord依存Plugin Workerを開始しません');
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

      const componentSecret = process.env['LFG_COMPONENT_SECRET']?.trim();
      if (!componentSecret || componentSecret.length < 32) {
        logger.warn('LFG_COMPONENT_SECRETが未設定または短いためLFG Workerを開始しません');
      } else {
        try {
          lfgRuntime = await startLfgRuntime({
            prisma: getPrismaClient(),
            logger,
            discordBotToken,
            componentSecret,
          });
          logger.info('LFG Workerを開始しました');
        } catch (error) {
          logger.error({ errorName: resolveErrorName(error) }, 'LFG Workerの開始に失敗しました');
          process.exit(1);
        }
      }

      const teamSplitSecret = process.env['TEAM_SPLIT_SECRET']?.trim();
      if (!teamSplitSecret || teamSplitSecret.length < 32) {
        logger.warn('TEAM_SPLIT_SECRETが未設定または短いためTeam Split Workerを開始しません');
      } else {
        try {
          teamSplitRuntime = await startTeamSplitRuntime({
            prisma: getPrismaClient(),
            logger,
            discordBotToken,
            secret: teamSplitSecret,
          });
          logger.info('Team Split Workerを開始しました');
        } catch (error) {
          logger.error(
            { errorName: resolveErrorName(error) },
            'Team Split Workerの開始に失敗しました',
          );
          process.exit(1);
        }
      }
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
    await teamSplitRuntime?.close();
    teamSplitRuntime = undefined;
  } catch (error) {
    logger.error(
      { errorName: resolveErrorName(error) },
      'Team Split Workerの終了処理に失敗しました',
    );
  }

  try {
    await lfgRuntime?.close();
    lfgRuntime = undefined;
  } catch (error) {
    logger.error({ errorName: resolveErrorName(error) }, 'LFG Workerの終了処理に失敗しました');
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
    await discordRoleOperationRuntime?.close();
    discordRoleOperationRuntime = undefined;
  } catch (error) {
    logger.error(
      { errorName: resolveErrorName(error) },
      'Discord Role Operation Workerの終了処理に失敗しました',
    );
  }

  try {
    await communitySeasonRuntime?.close();
    communitySeasonRuntime = undefined;
  } catch (error) {
    logger.error(
      { errorName: resolveErrorName(error) },
      'Community Season Snapshot Workerの終了処理に失敗しました',
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
