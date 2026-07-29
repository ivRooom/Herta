import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/worker/src/lfg.ts';
let content = await readFile(path, 'utf8');

function replaceOne(before, after) {
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one block, received ${count}`);
  content = content.replace(before, after);
}

replaceOne(
  `  buildLfgDiscordMessage,\n`,
  `  buildLfgDiscordMessage,\n  createLfgMessageNonce,\n`,
);
replaceOne(
  `      await updateLfgMessageReference(options.prisma as unknown as LfgPrismaClient, {\n        guildId: post.guildId,\n        postId: post.id,\n        messageId,\n        actorId: 'system',\n        expectedVersion: post.version,\n      });\n      options.logger.info(`,
  `      const linked = await updateLfgMessageReference(\n        options.prisma as unknown as LfgPrismaClient,\n        {\n          guildId: post.guildId,\n          postId: post.id,\n          messageId,\n          actorId: 'system',\n          expectedVersion: post.version,\n        },\n      );\n      if (!linked || linked.messageId !== messageId) {\n        try {\n          await deleteDiscordMessage(options, post.channelId, messageId);\n        } catch (error) {\n          options.logger.warn(\n            { guildId: post.guildId, postId: post.id, errorName: resolveErrorName(error) },\n            'version競合後のLFGメッセージ削除に失敗しました',\n          );\n        }\n        continue;\n      }\n      options.logger.info(`,
);
replaceOne(
  `    body: JSON.stringify(buildLfgDiscordMessage(post, participantIds, options.componentSecret)),`,
  `    body: JSON.stringify({\n      ...buildLfgDiscordMessage(post, participantIds, options.componentSecret),\n      nonce: createLfgMessageNonce(post.id, post.version),\n      enforce_nonce: true,\n    }),`,
);
replaceOne(
  `async function updateDiscordMessage(`,
  `async function deleteDiscordMessage(\n  options: StartLfgRuntimeOptions,\n  channelId: string,\n  messageId: string,\n): Promise<void> {\n  const response = await fetch(\n    \`\${DISCORD_API_BASE_URL}/channels/\${channelId}/messages/\${messageId}\`,\n    {\n      method: 'DELETE',\n      headers: { Authorization: \`Bot \${options.discordBotToken}\` },\n      signal: AbortSignal.timeout(10_000),\n    },\n  );\n  if (!response.ok && response.status !== 404) {\n    throw new LfgDiscordError('LfgDiscordDeleteMessageFailed', response.status);\n  }\n}\n\nasync function updateDiscordMessage(`,
);

await writeFile(path, content);
