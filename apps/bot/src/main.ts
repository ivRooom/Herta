import {
  getPrismaClient,
  pruneCommandExecutionEvents,
  pruneServiceHealthSnapshots,
  recordServiceHealthSnapshot,
  type ServiceHealthSnapshotInput,
} from '@herta/db';
import {
  pruneAutoResponseExecutionEvents,
  type AutoResponsePrismaClient,
} from '@herta/plugin-catalog/auto-response-service';
import { createLogger } from '@herta/logger';
import { HERTA_STUDIO_ROOT_DISCORD_ROLE_ID } from '@herta/shared';
import { HertaBot } from './bot.js';
import { loadHealthConfig } from './health/config.js';
import { HealthHttpServer } from './health/server.js';
import { HertaHealthService } from './health/service.js';
import { RuleProductionRuntime } from './rules/runtime.js';
import { createPrismaRuleRuntimeStore } from './rules/store.js';

const logger = createLogger({
  name: 'herta-bot',
  level: process.env['BOT_LOG_LEVEL'],
});

const healthConfig = loadHealthConfig();
const bot = new HertaBot(logger, healthConfig.heartbeatStaleMs);
const ruleRuntime = process.env['DATABASE_URL']
  ? new RuleProductionRuntime({
      store: createPrismaRuleRuntimeStore(getPrismaClient()),
      memberRoles: {
        addRole: (input) => bot.addRuleMemberRole(input),
      },
      security: {
        authorizeRuleActor: async (guildId, actorId) => {
          const members = await bot.searchGuildMembers(guildId, actorId, 1);
          const actor = members?.find((member) => member.id === actorId);
          return actor?.roleIds.includes(HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) ?? false;
        },
        canCreateRole: async (guildId) => {
          const options = await bot.getGuildConfigurationOptions(guildId);
          return options?.bot.manageRoles ?? false;
        },
        canDeleteRole: async (guildId, roleId) => {
          if (roleId === HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) return false;
          const options = await bot.getGuildConfigurationOptions(guildId);
          if (!options?.bot.manageRoles) return false;
          const role = options.roles.find((candidate) => candidate.id === roleId);
          return Boolean(role && role.editable && !role.managed);
        },
      },
      logger,
    })
  : undefined;

bot.setRuleRuntimeEventSink(
  ruleRuntime ? { memberJoined: (input) => ruleRuntime.dispatchMemberJoined(input) } : undefined,
);

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
      getGuildOptions: (guildId) => bot.getGuildConfigurationOptions(guildId),
      searchGuildMembers: (guildId, query, limit) => bot.searchGuildMembers(guildId, query, limit),
      getGuildBotProfile: (guildId) => bot.getGuildBotProfile(guildId),
      updateGuildBotProfile: (guildId, input) => bot.updateGuildBotProfile(guildId, input),
      internalApiSecret: process.env['BOT_INTERNAL_API_SECRET']?.trim(),
    })
  : undefined;

const RETENTION_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const EXECUTION_ANALYTICS_RETENTION_DAYS = 90;
const HEALTH_SNAPSHOT_RETENTION_DAYS = 31;
const HEALTH_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000;
const HEALTH_SNAPSHOT_BUFFER_LIMIT = Math.ceil(
  (HEALTH_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1_000) / HEALTH_SNAPSHOT_INTERVAL_MS,
);

let shuttingDown = false;
let retentionPruneInFlight = false;
let retentionPruneTimer: NodeJS.Timeout | undefined;
let healthSnapshotTimer: NodeJS.Timeout | undefined;
let healthSnapshotRun: Promise<void> | undefined;
let healthSnapshotCollectionActive = false;
const pendingHealthSnapshots: ServiceHealthSnapshotInput[] = [];

async function pruneRetainedData(): Promise<void> {
  if (!process.env['DATABASE_URL'] || retentionPruneInFlight) return;

  retentionPruneInFlight = true;
  try {
    const prisma = getPrismaClient();
    const [commandDeleted, autoResponseDeleted, healthSnapshotDeleted] = await Promise.all([
      pruneCommandExecutionEvents(prisma, EXECUTION_ANALYTICS_RETENTION_DAYS),
      pruneAutoResponseExecutionEvents(
        prisma as unknown as AutoResponsePrismaClient,
        EXECUTION_ANALYTICS_RETENTION_DAYS,
      ),
      pruneServiceHealthSnapshots(prisma, HEALTH_SNAPSHOT_RETENTION_DAYS),
    ]);
    if (commandDeleted > 0) {
      logger.info(
        { deleted: commandDeleted, retentionDays: EXECUTION_ANALYTICS_RETENTION_DAYS },
        '古いコマンド実行履歴を削除しました',
      );
    }
    if (autoResponseDeleted > 0) {
      logger.info(
        { deleted: autoResponseDeleted, retentionDays: EXECUTION_ANALYTICS_RETENTION_DAYS },
        '古いAuto Response実行履歴を削除しました',
      );
    }
    if (healthSnapshotDeleted > 0) {
      logger.info(
        { deleted: healthSnapshotDeleted, retentionDays: HEALTH_SNAPSHOT_RETENTION_DAYS },
        '古いHealth Snapshotを削除しました',
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '古いTelemetryデータの整理に失敗しました');
  } finally {
    retentionPruneInFlight = false;
  }
}

function startRetentionPruning(): void {
  if (!process.env['DATABASE_URL'] || retentionPruneTimer) return;

  retentionPruneTimer = setInterval(() => {
    void pruneRetainedData();
  }, RETENTION_PRUNE_INTERVAL_MS);
  retentionPruneTimer.unref();
}

function stopRetentionPruning(): void {
  if (!retentionPruneTimer) return;
  clearInterval(retentionPruneTimer);
  retentionPruneTimer = undefined;
}

function bufferHealthSnapshot(snapshot: ServiceHealthSnapshotInput): void {
  if (pendingHealthSnapshots.length >= HEALTH_SNAPSHOT_BUFFER_LIMIT) {
    pendingHealthSnapshots.shift();
    logger.warn(
      { limit: HEALTH_SNAPSHOT_BUFFER_LIMIT },
      'Health Snapshot一時バッファが上限に達したため最古の記録を破棄しました',
    );
  }
  pendingHealthSnapshots.push(snapshot);
}

async function persistHealthSnapshot(snapshot: ServiceHealthSnapshotInput): Promise<void> {
  const prisma = getPrismaClient();
  while (healthSnapshotCollectionActive && pendingHealthSnapshots.length > 0) {
    await recordServiceHealthSnapshot(prisma, pendingHealthSnapshots[0]!);
    pendingHealthSnapshots.shift();
  }
  if (!healthSnapshotCollectionActive) return;
  await recordServiceHealthSnapshot(prisma, snapshot);
}

async function collectHealthSnapshot(): Promise<void> {
  const health = await healthService.getHealth();
  if (!healthSnapshotCollectionActive) return;

  const snapshot: ServiceHealthSnapshotInput = {
    serviceId: health.service.id,
    version: health.version,
    status: health.status,
    discordStatus: health.checks.discord.status,
    databaseStatus: health.checks.database.status,
    redisStatus: health.checks.redis.status,
    workerStatus: health.checks.worker.status,
    databaseLatencyMs: health.checks.database.latency_ms ?? null,
    redisLatencyMs: health.checks.redis.latency_ms ?? null,
    workerLatencyMs: health.checks.worker.latency_ms ?? null,
    guildCount: health.guild_count,
    uptimeSeconds: health.uptime_seconds,
    checkedAt: new Date(health.checked_at),
  };

  try {
    await persistHealthSnapshot(snapshot);
  } catch (error) {
    if (healthSnapshotCollectionActive) bufferHealthSnapshot(snapshot);
    logger.warn(
      { err: error, buffered: pendingHealthSnapshots.length },
      'Health Snapshotの保存に失敗したため一時バッファへ保持しました',
    );
  }
}

async function recordHealthSnapshot(): Promise<void> {
  if (!process.env['DATABASE_URL'] || !healthSnapshotCollectionActive || healthSnapshotRun) {
    return;
  }

  const run = collectHealthSnapshot();
  healthSnapshotRun = run;
  try {
    await run;
  } finally {
    if (healthSnapshotRun === run) healthSnapshotRun = undefined;
  }
}

function startHealthSnapshotCollection(): void {
  if (!process.env['DATABASE_URL'] || healthSnapshotCollectionActive) return;
  healthSnapshotCollectionActive = true;
  void recordHealthSnapshot();
  healthSnapshotTimer = setInterval(() => {
    void recordHealthSnapshot();
  }, HEALTH_SNAPSHOT_INTERVAL_MS);
  healthSnapshotTimer.unref();
}

async function stopHealthSnapshotCollection(): Promise<void> {
  healthSnapshotCollectionActive = false;
  if (healthSnapshotTimer) {
    clearInterval(healthSnapshotTimer);
    healthSnapshotTimer = undefined;
  }
  await healthSnapshotRun?.catch(() => undefined);
}

async function main(): Promise<void> {
  logger.info('Herta Bot を起動しています...');
  try {
    await pruneRetainedData();
    await healthServer?.start();
    await bot.start();
    if (ruleRuntime) {
      try {
        await ruleRuntime.start();
      } catch (error) {
        logger.error(
          { err: error },
          'Rule Engine production runtimeの開始に失敗しました。Bot本体は継続します',
        );
      }
    }
    startRetentionPruning();
    startHealthSnapshotCollection();
  } catch (error) {
    stopRetentionPruning();
    await stopHealthSnapshotCollection();
    await ruleRuntime?.close().catch(() => undefined);
    await healthServer?.stop().catch(() => undefined);
    logger.fatal(error, 'Bot の起動に失敗しました');
    process.exitCode = 1;
  }
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopRetentionPruning();
  await stopHealthSnapshotCollection();
  logger.info({ signal }, 'シャットダウン中...');

  const results = await Promise.allSettled([
    ruleRuntime?.close(),
    healthServer?.stop(),
    bot.stop(),
  ]);
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
