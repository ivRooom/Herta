import { readFile, writeFile } from 'node:fs/promises';

const pending = new Map();

async function read(path) {
  if (pending.has(path)) return pending.get(path);
  const value = await readFile(path, 'utf8');
  pending.set(path, value);
  return value;
}

async function replaceOne(path, before, after) {
  let content = await read(path);
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one block, received ${count}`);
  content = content.replace(before, after);
  pending.set(path, content);
}

async function replaceAllExact(path, before, after, expectedCount) {
  let content = await read(path);
  const count = content.split(before).length - 1;
  if (count === 0 && content.includes(after)) return;
  if (count !== expectedCount) {
    throw new Error(`${path}: expected ${expectedCount} blocks, received ${count}`);
  }
  content = content.replaceAll(before, after);
  pending.set(path, content);
}

await replaceAllExact(
  'plugins/lfg/src/service.ts',
  `        updatedBy: input.actorId ?? input.userId,\n        version: { increment: 1 },`,
  `        updatedBy: input.actorId ?? input.userId,\n        messageState: 'pending',\n        lastErrorName: null,\n        version: { increment: 1 },`,
  2,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `        closedAt: now,\n        updatedBy: input.actorId,\n        version: { increment: 1 },`,
  `        closedAt: now,\n        updatedBy: input.actorId,\n        messageState: 'pending',\n        lastErrorName: null,\n        version: { increment: 1 },`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `      data: { status: 'expired', closedAt: now, version: { increment: 1 } },`,
  `      data: {\n        status: 'expired',\n        closedAt: now,\n        messageState: 'pending',\n        lastErrorName: null,\n        version: { increment: 1 },\n      },`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `    data: { status: 'expired', closedAt: now, version: { increment: 1 } },`,
  `    data: {\n      status: 'expired',\n      closedAt: now,\n      messageState: 'pending',\n      lastErrorName: null,\n      version: { increment: 1 },\n    },`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `export async function markLfgMessageMissing(\n`,
  `export async function markLfgMessageSynchronized(\n  prisma: LfgPrismaClient,\n  input: { guildId: string; postId: string },\n): Promise<LfgPostRecord | null> {\n  const post = await prisma.lfgPost.findFirst({\n    where: { id: input.postId, guildId: input.guildId, deletedAt: null },\n  });\n  if (!post) return null;\n  return prisma.lfgPost.update({\n    where: { id: post.id },\n    data: { messageState: 'active', lastErrorName: null },\n  });\n}\n\nexport async function markLfgMessageMissing(\n`,
);

await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `  markLfgMessageMissing,\n  updateLfgMessageReference,`,
  `  markLfgMessageMissing,\n  markLfgMessageSynchronized,\n  updateLfgMessageReference,`,
);
await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `  customId: string;\n  user: { id: string };`,
  `  customId: string;\n  message: { id: string };\n  user: { id: string };`,
);
await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `  const participants = await listLfgParticipants(context.prisma, context.guildId, post.id);\n  await interaction.update(\n    renderLfgMessage(\n      post,\n      participants.map((item) => item.userId),\n    ),\n  );`,
  `  const participants = await listLfgParticipants(context.prisma, context.guildId, post.id);\n  try {\n    await interaction.update(\n      renderLfgMessage(\n        post,\n        participants.map((item) => item.userId),\n      ),\n    );\n    await markLfgMessageSynchronized(context.prisma, {\n      guildId: context.guildId,\n      postId: post.id,\n    });\n  } catch (error) {\n    context.logger.warn(\n      { guildId: context.guildId, postId: post.id, errorName: resolveErrorName(error) },\n      'LFG Button操作後のDiscord表示更新に失敗しました。Workerで再同期します',\n    );\n    if (!interaction.replied && !interaction.deferred) {\n      await respond(interaction, '参加状態は更新されました。表示はWorkerが再同期します');\n    }\n  }`,
);
await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `    await message.edit(\n      renderLfgMessage(\n        post,\n        participants.map((item) => item.userId),\n      ),\n    );`,
  `    await message.edit(\n      renderLfgMessage(\n        post,\n        participants.map((item) => item.userId),\n      ),\n    );\n    await markLfgMessageSynchronized(context.prisma, {\n      guildId: context.guildId,\n      postId: post.id,\n    });`,
);

await replaceOne(
  'apps/worker/src/lfg.ts',
  `  listLfgParticipants,\n  updateLfgMessageReference,`,
  `  listLfgParticipants,\n  markLfgMessageMissing,\n  markLfgMessageSynchronized,\n  updateLfgMessageReference,`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `      await expireDuePosts(options);\n      await recoverMissingMessages(options);`,
  `      await expireDuePosts(options);\n      await synchronizePendingMessages(options);\n      await recoverMissingMessages(options);`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `    if (!expired) continue;\n    if (expired.messageId) {\n      await updateDiscordMessage(options, expired).catch(async (error) => {\n        await recordMessageFailure(options.prisma, expired, error);\n      });\n    }\n    options.logger.info(`,
  `    if (!expired) continue;\n    options.logger.info(`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `async function recoverMissingMessages(options: StartLfgRuntimeOptions): Promise<void> {`,
  `async function synchronizePendingMessages(options: StartLfgRuntimeOptions): Promise<void> {\n  const retryBefore = new Date(Date.now() - RECOVERY_RETRY_DELAY_MS);\n  const posts = await options.prisma.lfgPost.findMany({\n    where: {\n      messageId: { not: null },\n      deletedAt: null,\n      OR: [\n        { messageState: 'pending' },\n        { messageState: 'failed', updatedAt: { lte: retryBefore } },\n      ],\n    },\n    orderBy: { updatedAt: 'asc' },\n    take: SCAN_LIMIT,\n  });\n\n  for (const post of posts) {\n    const pluginEnabled = await isLfgPluginEnabled(\n      options.prisma as unknown as LfgPrismaClient,\n      post.guildId,\n    );\n    if (!pluginEnabled) continue;\n    try {\n      await updateDiscordMessage(options, post as LfgPostRecord);\n      await markLfgMessageSynchronized(options.prisma as unknown as LfgPrismaClient, {\n        guildId: post.guildId,\n        postId: post.id,\n      });\n    } catch (error) {\n      await recordMessageFailure(options.prisma, post as LfgPostRecord, error);\n    }\n  }\n}\n\nasync function recoverMissingMessages(options: StartLfgRuntimeOptions): Promise<void> {`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `async function recordMessageFailure(\n  prisma: PrismaClient,\n  post: LfgPostRecord,\n  error: unknown,\n): Promise<void> {\n  await prisma.lfgPost.update({`,
  `async function recordMessageFailure(\n  prisma: PrismaClient,\n  post: LfgPostRecord,\n  error: unknown,\n): Promise<void> {\n  if (\n    error instanceof LfgDiscordError &&\n    error.httpStatus === 404 &&\n    (post.status === 'open' || post.status === 'full') &&\n    post.messageId\n  ) {\n    await markLfgMessageMissing(prisma as unknown as LfgPrismaClient, {\n      guildId: post.guildId,\n      messageId: post.messageId,\n      errorName: error.name,\n    });\n    return;\n  }\n  await prisma.lfgPost.update({`,
);

await replaceOne(
  'docker-compose.prod.yml',
  `      DISCORD_BOT_TOKEN: \${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is required}\n      DISCORD_ENABLE_MESSAGE_CONTENT_INTENT:`,
  `      DISCORD_BOT_TOKEN: \${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is required}\n      LFG_COMPONENT_SECRET: \${LFG_COMPONENT_SECRET:?LFG_COMPONENT_SECRET is required}\n      DISCORD_ENABLE_MESSAGE_CONTENT_INTENT:`,
);
await replaceOne(
  'docker-compose.prod.yml',
  `      REDIS_URL: \${REDIS_URL:?REDIS_URL is required}\n      WORKER_LOG_LEVEL: \${WORKER_LOG_LEVEL:-info}\n      HEALTH_HEARTBEAT_STALE_MS: \${HEALTH_HEARTBEAT_STALE_MS:-120000}`,
  `      REDIS_URL: \${REDIS_URL:?REDIS_URL is required}\n      DISCORD_BOT_TOKEN: \${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is required}\n      LFG_COMPONENT_SECRET: \${LFG_COMPONENT_SECRET:?LFG_COMPONENT_SECRET is required}\n      DAILY_CONTENT_SCAN_INTERVAL_SECONDS: \${DAILY_CONTENT_SCAN_INTERVAL_SECONDS:-30}\n      LFG_SCAN_INTERVAL_SECONDS: \${LFG_SCAN_INTERVAL_SECONDS:-30}\n      WORKER_LOG_LEVEL: \${WORKER_LOG_LEVEL:-info}\n      HEALTH_HEARTBEAT_STALE_MS: \${HEALTH_HEARTBEAT_STALE_MS:-120000}`,
);

await replaceAllExact(
  'apps/studio/src/components/lfg-manager.tsx',
  `className="input"`,
  `className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"`,
  5,
);
await replaceOne(
  'apps/studio/src/components/lfg-manager.tsx',
  `className="input min-h-24 resize-y"`,
  `className="min-h-24 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm"`,
);

for (const [path, content] of pending) {
  await writeFile(path, content);
}
