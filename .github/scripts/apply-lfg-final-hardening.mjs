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

await replaceOne(
  'plugins/lfg/src/service.ts',
  `        status: normalized.maxPlayers === 1 ? 'full' : 'open',`,
  `        status: 'open',`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `              data: { status: 'full', participantCount: joinedCount, version: { increment: 1 } },`,
  `              data: {\n                status: 'full',\n                participantCount: joinedCount,\n                messageState: 'pending',\n                lastErrorName: null,\n                version: { increment: 1 },\n              },`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `  input: { guildId: string; postId: string; messageId: string; actorId: string },`,
  `  input: {\n    guildId: string;\n    postId: string;\n    messageId: string;\n    actorId: string;\n    expectedVersion: number;\n  },`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `    if (!post) return null;\n    return tx.lfgPost.update({\n      where: { id: post.id },\n      data: {\n        messageId: input.messageId,`,
  `    if (!post || post.version !== input.expectedVersion) return post;\n    return tx.lfgPost.update({\n      where: { id: post.id },\n      data: {\n        messageId: input.messageId,`,
);
await replaceOne(
  'plugins/lfg/src/service.ts',
  `  input: { guildId: string; postId: string },\n): Promise<LfgPostRecord | null> {\n  const post = await prisma.lfgPost.findFirst({\n    where: { id: input.postId, guildId: input.guildId, deletedAt: null },\n  });\n  if (!post) return null;\n  return prisma.lfgPost.update({\n    where: { id: post.id },\n    data: { messageState: 'active', lastErrorName: null },\n  });\n}`,
  `  input: { guildId: string; postId: string; expectedVersion: number },\n): Promise<LfgPostRecord | null> {\n  return prisma.$transaction(async (tx) => {\n    await lockPost(tx, input.guildId, input.postId);\n    const post = await tx.lfgPost.findFirst({\n      where: { id: input.postId, guildId: input.guildId, deletedAt: null },\n    });\n    if (!post || post.version !== input.expectedVersion) return post;\n    return tx.lfgPost.update({\n      where: { id: post.id },\n      data: { messageState: 'active', lastErrorName: null },\n    });\n  });\n}`,
);

await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `        actorId: interaction.user.id,\n      });`,
  `        actorId: interaction.user.id,\n        expectedVersion: post.version,\n      });`,
);
await replaceAllExact(
  'plugins/lfg/src/plugin.ts',
  `      postId: post.id,\n    });`,
  `      postId: post.id,\n      expectedVersion: post.version,\n    });`,
  2,
);
await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `          if (!interaction?.isButton()) return;\n          await executeLfgButton(context, interaction);`,
  `          if (!interaction?.isButton()) return;\n          try {\n            await executeLfgButton(context, interaction);\n          } catch (error) {\n            context.logger.error(\n              { guildId: context.guildId, errorName: resolveErrorName(error) },\n              'LFG Button操作に失敗しました',\n            );\n            if (!interaction.replied && !interaction.deferred) {\n              await respond(interaction, 'LFG Button操作に失敗しました');\n            }\n          }`,
);
await replaceOne(
  'plugins/lfg/src/plugin.ts',
  `          if (!message?.guildId || message.guildId !== context.guildId) return;\n          await markLfgMessageMissing(context.prisma, {\n            guildId: context.guildId,\n            messageId: message.id,\n          });`,
  `          if (!message?.guildId || message.guildId !== context.guildId) return;\n          try {\n            await markLfgMessageMissing(context.prisma, {\n              guildId: context.guildId,\n              messageId: message.id,\n            });\n          } catch (error) {\n            context.logger.error(\n              { guildId: context.guildId, errorName: resolveErrorName(error) },\n              'LFG募集メッセージ削除状態の記録に失敗しました',\n            );\n          }`,
);

await replaceOne(
  'apps/worker/src/lfg.ts',
  `  isLfgPluginEnabled,\n  listDueLfgPosts,`,
  `  isLfgPluginEnabled,\n  listDueLfgPosts,\n  normalizeLfgConfig,`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `const SCAN_LIMIT = 100;`,
  `const SCAN_LIMIT = 100;\nconst PRUNE_INTERVAL_MS = 60 * 60 * 1000;`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `  let scanning = false;\n  let timer: NodeJS.Timeout | undefined;`,
  `  let scanning = false;\n  let lastPrunedAt = 0;\n  let timer: NodeJS.Timeout | undefined;`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `      await synchronizePendingMessages(options);\n      await recoverMissingMessages(options);`,
  `      await synchronizePendingMessages(options);\n      await recoverMissingMessages(options);\n      if (Date.now() - lastPrunedAt >= PRUNE_INTERVAL_MS) {\n        await pruneEndedPosts(options);\n        lastPrunedAt = Date.now();\n      }`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `  for (const due of duePosts) {\n    const expired = await expireLfgPost(prisma, {`,
  `  for (const due of duePosts) {\n    const pluginEnabled = await isLfgPluginEnabled(prisma, due.guildId);\n    if (!pluginEnabled) continue;\n    const expired = await expireLfgPost(prisma, {`,
);
await replaceAllExact(
  'apps/worker/src/lfg.ts',
  `        postId: post.id,\n      });`,
  `        postId: post.id,\n        expectedVersion: post.version,\n      });`,
  1,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `        actorId: 'system',\n      });`,
  `        actorId: 'system',\n        expectedVersion: post.version,\n      });`,
);
await replaceOne(
  'apps/worker/src/lfg.ts',
  `async function createDiscordMessage(`,
  `async function pruneEndedPosts(options: StartLfgRuntimeOptions): Promise<void> {\n  const plugins = await options.prisma.guildPlugin.findMany({\n    where: { pluginId: 'lfg' },\n    select: { guildId: true, config: true },\n  });\n  const now = new Date();\n  for (const plugin of plugins) {\n    const config = normalizeLfgConfig(plugin.config);\n    const before = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);\n    const result = await options.prisma.lfgPost.updateMany({\n      where: {\n        guildId: plugin.guildId,\n        status: { in: ['closed', 'cancelled', 'expired'] },\n        deletedAt: null,\n        OR: [{ closedAt: { lte: before } }, { closedAt: null, updatedAt: { lte: before } }],\n      },\n      data: { deletedAt: now },\n    });\n    if (result.count > 0) {\n      options.logger.info(\n        { guildId: plugin.guildId, count: result.count },\n        '保持期間を超えたLFG募集をSoft Deleteしました',\n      );\n    }\n  }\n}\n\nasync function createDiscordMessage(`,
);

for (const [path, content] of pending) {
  await writeFile(path, content);
}
