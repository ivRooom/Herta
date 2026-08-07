import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const path = 'packages/db/prisma/schema.prisma';
let source = readFileSync(path, 'utf8');
const marker = `@@map("moderation_detection_events")\n}\n\n// ============================================================\n// Plugin: Quote`;
const replacement = `@@map("moderation_detection_events")\n}\n\nmodel ModerationBlacklistEntry {\n  guildId           String   @map("guild_id")\n  userId            String   @map("user_id")\n  reason            String?\n  originDetectionId String?  @map("origin_detection_id") @db.Uuid\n  createdBy         String   @map("created_by")\n  active            Boolean  @default(true)\n  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(3)\n  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)\n\n  @@id([guildId, userId])\n  @@index([guildId, active, createdAt(sort: Desc)])\n  @@index([userId])\n  @@map("moderation_blacklist_entries")\n}\n\n// ============================================================\n// Plugin: Quote`;
if (!source.includes(marker)) throw new Error('ModerationDetectionEvent末尾が見つかりません');
if (source.includes('model ModerationBlacklistEntry')) throw new Error('ModerationBlacklistEntryは既に存在します');
source = source.replace(marker, replacement);
writeFileSync(path, source);
rmSync('scripts/add-moderation-blacklist-prisma-model.mjs');
rmSync('.github/workflows/add-moderation-blacklist-prisma-model.yml');
