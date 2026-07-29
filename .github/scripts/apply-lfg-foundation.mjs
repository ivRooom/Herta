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
  if (count !== 1) throw new Error(`${path}: expected one source block, received ${count}`);
  content = content.replace(before, after);
  pending.set(path, content);
}

await replaceOne(
  'packages/db/prisma/schema.prisma',
  `model LfgPost {\n  id          String    @id @default(uuid())\n  guildId     String    @map("guild_id")\n  creatorId   String    @map("creator_id")\n  game        String\n  title       String\n  description String?\n  maxPlayers  Int       @default(5) @map("max_players")\n  startTime   DateTime? @map("start_time")\n  channelId   String    @map("channel_id")\n  messageId   String?   @map("message_id")\n  status      String    @default("open")\n  createdAt   DateTime  @default(now()) @map("created_at")\n\n  participants LfgParticipant[]\n\n  @@index([guildId, status])\n  @@map("lfg_posts")\n}\n\nmodel LfgParticipant {\n  lfgId    String   @map("lfg_id")\n  userId   String   @map("user_id")\n  status   String   @default("joined")\n  joinedAt DateTime @default(now()) @map("joined_at")\n\n  lfgPost LfgPost @relation(fields: [lfgId], references: [id], onDelete: Cascade)\n\n  @@id([lfgId, userId])\n  @@map("lfg_participants")\n}`,
  `model LfgPost {\n  id               String    @id @default(uuid())\n  guildId          String    @map("guild_id")\n  creatorId        String    @map("creator_id")\n  channelId        String    @map("channel_id")\n  messageId        String?   @map("message_id")\n  game             String\n  title            String\n  description      String    @default("")\n  maxPlayers       Int       @default(5) @map("max_players")\n  participantCount Int       @default(1) @map("participant_count")\n  startTime        DateTime? @map("start_time") @db.Timestamptz(3)\n  expiresAt        DateTime  @map("expires_at") @db.Timestamptz(3)\n  status           String    @default("open")\n  messageState     String    @default("pending") @map("message_state")\n  lastErrorName    String?   @map("last_error_name")\n  closedAt         DateTime? @map("closed_at") @db.Timestamptz(3)\n  createdBy        String?   @map("created_by")\n  updatedBy        String?   @map("updated_by")\n  deletedAt        DateTime? @map("deleted_at") @db.Timestamptz(3)\n  version          Int       @default(1)\n  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)\n  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)\n\n  participants LfgParticipant[]\n\n  @@index([guildId, status])\n  @@index([guildId, channelId, status])\n  @@index([guildId, creatorId, createdAt(sort: Desc)])\n  @@index([status, expiresAt])\n  @@map("lfg_posts")\n}\n\nmodel LfgParticipant {\n  lfgId    String    @map("lfg_id")\n  guildId  String    @map("guild_id")\n  userId   String    @map("user_id")\n  status   String    @default("joined")\n  joinedAt DateTime  @default(now()) @map("joined_at") @db.Timestamptz(3)\n  leftAt   DateTime? @map("left_at") @db.Timestamptz(3)\n  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)\n\n  lfgPost LfgPost @relation(fields: [lfgId], references: [id], onDelete: Cascade)\n\n  @@id([lfgId, userId])\n  @@index([guildId, status])\n  @@map("lfg_participants")\n}`,
);

await replaceOne(
  'apps/bot/src/plugins/registry.ts',
  `import { dailyContentPlugin } from '@herta/plugin-catalog/daily-content-runtime';\n`,
  `import { dailyContentPlugin } from '@herta/plugin-catalog/daily-content-runtime';\nimport { lfgPlugin } from '@herta/plugin-catalog/lfg-runtime';\n`,
);

await replaceOne(
  'apps/bot/src/plugins/registry.ts',
  `  const moderationEntry = deps\n`,
  `  const lfgEntry = deps\n    ? toRuntimePluginEntry(\n        lfgPlugin,\n        (plugin, guildId, config) =>\n          createPluginContext({\n            client: deps.client,\n            prisma: deps.prisma,\n            logger: deps.logger,\n            guildId,\n            config,\n            manifest: plugin.manifest,\n          }) as Parameters<NonNullable<typeof lfgPlugin.onEnable>>[0],\n      )\n    : undefined;\n  const moderationEntry = deps\n`,
);

await replaceOne(
  'apps/bot/src/plugins/registry.ts',
  `    if (pluginId === 'daily-content' && dailyContentEntry) return [dailyContentEntry];\n    if (pluginId === 'moderation' && moderationEntry) return [moderationEntry];`,
  `    if (pluginId === 'daily-content' && dailyContentEntry) return [dailyContentEntry];\n    if (pluginId === 'lfg' && lfgEntry) return [lfgEntry];\n    if (pluginId === 'moderation' && moderationEntry) return [moderationEntry];`,
);

await replaceOne(
  'plugins/lfg/src/service.ts',
  `        status: normalized.maxPlayers === 1 ? 'full' : 'open',`,
  `        status: 'open',`,
);

for (const [path, content] of pending) {
  await writeFile(path, content);
}
