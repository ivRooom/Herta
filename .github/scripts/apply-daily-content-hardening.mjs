import { readFile, writeFile } from 'node:fs/promises';

const pendingWrites = new Map();

async function read(path) {
  if (pendingWrites.has(path)) return pendingWrites.get(path);
  const content = await readFile(path, 'utf8');
  pendingWrites.set(path, content);
  return content;
}

async function replaceOne(path, before, after) {
  let content = await read(path);
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one source block, received ${count}`);
  content = content.replace(before, after);
  pendingWrites.set(path, content);
}

async function replaceAllExact(path, before, after, expectedCount) {
  let content = await read(path);
  if (content.includes(after) && !content.includes(before)) return;
  const count = content.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${path}: expected ${expectedCount} source blocks, received ${count}`);
  }
  content = content.replaceAll(before, after);
  pendingWrites.set(path, content);
}

await replaceOne(
  'plugins/daily-content/src/service.ts',
  `  lastSentAt: Date | null;\n  createdBy: string | null;`,
  `  lastSentAt: Date | null;\n  deletedAt: Date | null;\n  createdBy: string | null;`,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `    const count = await tx.dailyContent.count({ where: { guildId: input.guildId } });`,
  `    const count = await tx.dailyContent.count({\n      where: { guildId: input.guildId, deletedAt: null },\n    });`,
);
await replaceAllExact(
  'plugins/daily-content/src/service.ts',
  `where: { id: input.scheduleId, guildId: input.guildId },`,
  `where: { id: input.scheduleId, guildId: input.guildId, deletedAt: null },`,
  3,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `    await tx.dailyContent.delete({ where: { id: current.id } });`,
  `    await tx.dailyContent.update({\n      where: { id: current.id },\n      data: {\n        enabled: false,\n        nextRunAt: null,\n        deletedAt: new Date(),\n        updatedBy: input.actorId,\n      },\n    });`,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `  return prisma.dailyContent.findFirst({ where: { id: scheduleId, guildId } });`,
  `  return prisma.dailyContent.findFirst({\n    where: { id: scheduleId, guildId, deletedAt: null },\n  });`,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `    where: { guildId },\n    orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],`,
  `    where: { guildId, deletedAt: null },\n    orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],`,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `    where: { enabled: true, nextRunAt: { lte: now } },`,
  `    where: { enabled: true, deletedAt: null, nextRunAt: { lte: now } },`,
);
await replaceOne(
  'plugins/daily-content/src/service.ts',
  `    const schedule = await tx.dailyContent.findFirst({ where: { id: scheduleId } });`,
  `    const schedule = await tx.dailyContent.findFirst({\n      where: { id: scheduleId, deletedAt: null },\n    });`,
);

await replaceOne(
  'packages/db/prisma/schema.prisma',
  `  lastSentAt      DateTime? @map("last_sent_at") @db.Timestamptz(3)\n  createdBy       String?   @map("created_by")`,
  `  lastSentAt      DateTime? @map("last_sent_at") @db.Timestamptz(3)\n  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(3)\n  createdBy       String?   @map("created_by")`,
);
await replaceOne(
  'packages/db/prisma/schema.prisma',
  `  dailyContent DailyContent @relation(fields: [dailyContentId], references: [id], onDelete: Cascade)`,
  `  dailyContent DailyContent @relation(fields: [dailyContentId], references: [id], onDelete: Restrict)`,
);

await replaceOne(
  'packages/db/prisma/migrations/20260729213000_daily_content_plugin_v1/migration.sql',
  `  ADD COLUMN "updated_by" TEXT;`,
  `  ADD COLUMN "updated_by" TEXT,\n  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);`,
);
await replaceOne(
  'packages/db/prisma/migrations/20260729213000_daily_content_plugin_v1/migration.sql',
  `    ON DELETE CASCADE ON UPDATE CASCADE`,
  `    ON DELETE RESTRICT ON UPDATE CASCADE`,
);

await replaceOne(
  'apps/worker/src/daily-content.ts',
  `  nextDailyOccurrence,\n  normalizeDailyContentConfig,`,
  `  nextDailyOccurrence,\n  normalizeDailyContentConfig,\n  normalizeDailyContentScanIntervalSeconds,\n  redisReconnectDelay,\n  resolveDailyContentQueueJobDisposition,`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `  type DailyContentConfig,\n  type DailyContentPrismaClient,`,
  `  type DailyContentConfig,\n  type DailyContentDeliveryRecord,\n  type DailyContentPrismaClient,`,
);
await replaceAllExact(
  'apps/worker/src/daily-content.ts',
  `    lazyConnect: true,\n  });`,
  `    lazyConnect: true,\n    retryStrategy: redisReconnectDelay,\n  });`,
  2,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `      for (const delivery of pending) {\n        const config = await resolveGuildConfig(options.prisma, delivery.guildId);\n        await queue.add(\n          'publish',\n          {\n            deliveryId: delivery.id,\n            scheduleId: delivery.dailyContentId,\n            guildId: delivery.guildId,\n            idempotencyKey: delivery.idempotencyKey,\n            scheduledFor: delivery.scheduledFor.toISOString(),\n          },\n          {\n            jobId: delivery.id,\n            attempts: config.maxAttempts,\n            backoff: { type: 'exponential', delay: BASE_RETRY_DELAY_MS },\n          },\n        );\n        await markDeliveryQueued(prisma, delivery.id, now);\n      }`,
  `      for (const delivery of pending) {\n        const config = await resolveGuildConfig(options.prisma, delivery.guildId);\n        await ensureDeliveryJob(queue, prisma, delivery, config, now);\n      }`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `  const schedulerConfig = normalizeDailyContentConfig({});\n  await scanNow();\n  timer = setInterval(() => {\n    void scanNow();\n  }, schedulerConfig.scanIntervalSeconds * 1000);`,
  `  const scanIntervalSeconds = normalizeDailyContentScanIntervalSeconds(\n    process.env['DAILY_CONTENT_SCAN_INTERVAL_SECONDS'],\n  );\n  await scanNow();\n  timer = setInterval(() => {\n    void scanNow();\n  }, scanIntervalSeconds * 1000);`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `  if (!plugin?.enabled || !delivery.dailyContent.enabled) {`,
  `  if (!plugin?.enabled || !delivery.dailyContent.enabled || delivery.dailyContent.deletedAt) {`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `    where: { enabled: true, nextRunAt: null },`,
  `    where: { enabled: true, deletedAt: null, nextRunAt: null },`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `async function recoverStale(\n  prisma: DailyContentPrismaClient,\n  now: Date,\n  logger: Logger,\n): Promise<void> {\n  const config = normalizeDailyContentConfig({});\n  const staleBefore = new Date(now.getTime() - config.staleAfterMinutes * 60 * 1000);\n  const stale = await listStaleDeliveries(prisma, staleBefore, DAILY_CONTENT_SCAN_LIMIT);\n  for (const delivery of stale) {\n    await recoverStaleDelivery(prisma, delivery.id, now);\n    logger.warn(\n      { deliveryId: delivery.id, guildId: delivery.guildId },\n      'staleなDaily Content配信を再キュー対象へ戻しました',\n    );\n  }\n}`,
  `async function recoverStale(\n  prisma: DailyContentPrismaClient,\n  now: Date,\n  logger: Logger,\n): Promise<void> {\n  const minimumStaleBefore = new Date(now.getTime() - 2 * 60 * 1000);\n  const stale = await listStaleDeliveries(prisma, minimumStaleBefore, DAILY_CONTENT_SCAN_LIMIT);\n  for (const delivery of stale) {\n    const config = await resolveGuildConfig(prisma as unknown as PrismaClient, delivery.guildId);\n    const guildStaleBefore = now.getTime() - config.staleAfterMinutes * 60 * 1000;\n    if (!delivery.startedAt || delivery.startedAt.getTime() >= guildStaleBefore) continue;\n    await recoverStaleDelivery(prisma, delivery.id, now);\n    logger.warn(\n      { deliveryId: delivery.id, guildId: delivery.guildId },\n      'staleなDaily Content配信を再キュー対象へ戻しました',\n    );\n  }\n}`,
);
await replaceOne(
  'apps/worker/src/daily-content.ts',
  `async function processDelivery(\n`,
  `async function ensureDeliveryJob(\n  queue: Queue<DailyContentJobData>,\n  prisma: DailyContentPrismaClient,\n  delivery: DailyContentDeliveryRecord,\n  config: DailyContentConfig,\n  now: Date,\n): Promise<void> {\n  const existing = await queue.getJob(delivery.id);\n  const state = existing ? await existing.getState() : null;\n  const disposition = resolveDailyContentQueueJobDisposition(state);\n  if (disposition === 'keep') {\n    await markDeliveryQueued(prisma, delivery.id, now);\n    return;\n  }\n  if (disposition === 'replace' && existing) {\n    await existing.remove();\n  }\n  await queue.add(\n    'publish',\n    {\n      deliveryId: delivery.id,\n      scheduleId: delivery.dailyContentId,\n      guildId: delivery.guildId,\n      idempotencyKey: delivery.idempotencyKey,\n      scheduledFor: delivery.scheduledFor.toISOString(),\n    },\n    {\n      jobId: delivery.id,\n      attempts: config.maxAttempts,\n      backoff: { type: 'exponential', delay: BASE_RETRY_DELAY_MS },\n    },\n  );\n  await markDeliveryQueued(prisma, delivery.id, now);\n}\n\nasync function processDelivery(\n`,
);

await replaceOne(
  'plugins/daily-content/src/service.test.ts',
  `    lastSentAt: null,\n    createdBy: 'user-1',`,
  `    lastSentAt: null,\n    deletedAt: null,\n    createdBy: 'user-1',`,
);

let docs = await read('docs/plugins/DAILY_CONTENT.md');
if (!docs.includes('DAILY_CONTENT_SCAN_INTERVAL_SECONDS')) {
  docs = docs.replace(
    `## 再試行とstale recovery\n`,
    `## Worker全体設定\n\nWorkerのdue走査間隔はGuild設定ではなく環境変数\`DAILY_CONTENT_SCAN_INTERVAL_SECONDS\`で指定します。既定30秒、最小10秒、最大300秒です。Redis接続は段階的な再接続delayを使用し、最大30秒で再試行します。\n\n## 再試行とstale recovery\n`,
  );
}
if (!docs.includes('Soft Delete')) {
  docs = docs.replace(
    `Studioではスケジュール作成・編集・停止・削除、次回配信、直近履歴、手動配信、失敗再実行を管理できます。`,
    `Studioではスケジュール作成・編集・停止・削除、次回配信、直近履歴、手動配信、失敗再実行を管理できます。削除はSoft Deleteとして扱い、過去の配信履歴とmessage IDを保持します。v1はテキスト配信のみで、Embed・添付ファイル・外部URL取得を行わないためSSRFの入力面を持ちません。`,
  );
}
pendingWrites.set('docs/plugins/DAILY_CONTENT.md', docs);

for (const [path, content] of pendingWrites) {
  await writeFile(path, content);
}
