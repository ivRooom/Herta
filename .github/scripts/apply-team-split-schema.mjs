import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/db/prisma/schema.prisma';
const content = await readFile(path, 'utf8');
const before = `model TeamSplitSession {
  id           String   @id @default(uuid())
  guildId      String   @map("guild_id")
  creatorId    String   @map("creator_id")
  channelId    String   @map("channel_id")
  teamCount    Int      @default(2) @map("team_count")
  mode         String   @default("random")
  participants String[] @default([])
  teams        Json?
  status       String   @default("pending")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([guildId, createdAt(sort: Desc)])
  @@map("team_split_sessions")
}`;
const after = `model TeamSplitSession {
  id               String    @id @default(uuid())
  guildId          String    @map("guild_id")
  creatorId        String    @map("creator_id")
  channelId        String    @map("channel_id")
  messageId        String?   @map("message_id")
  title            String    @default("Team Split")
  teamCount        Int       @default(2) @map("team_count")
  mode             String    @default("random")
  maxParticipants  Int       @default(20) @map("max_participants")
  participantCount Int       @default(0) @map("participant_count")
  participants     String[]  @default([])
  teams            Json?
  seedHash         String    @default("") @map("seed_hash")
  generation       Int       @default(0)
  status           String    @default("open")
  expiresAt        DateTime  @map("expires_at") @db.Timestamptz(3)
  splitAt          DateTime? @map("split_at") @db.Timestamptz(3)
  closedAt         DateTime? @map("closed_at") @db.Timestamptz(3)
  messageState     String    @default("pending") @map("message_state")
  lastErrorName    String?   @map("last_error_name")
  createdBy        String?   @map("created_by")
  updatedBy        String?   @map("updated_by")
  deletedAt        DateTime? @map("deleted_at") @db.Timestamptz(3)
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  participantRecords TeamSplitParticipant[]

  @@index([guildId, status])
  @@index([guildId, channelId, status])
  @@index([guildId, creatorId, createdAt(sort: Desc)])
  @@index([status, expiresAt])
  @@map("team_split_sessions")
}

model TeamSplitParticipant {
  sessionId String    @map("session_id")
  guildId   String    @map("guild_id")
  userId    String    @map("user_id")
  score     Int       @default(0)
  status    String    @default("joined")
  joinedAt  DateTime  @default(now()) @map("joined_at") @db.Timestamptz(3)
  leftAt    DateTime? @map("left_at") @db.Timestamptz(3)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  session TeamSplitSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@id([sessionId, userId])
  @@index([guildId, status])
  @@map("team_split_participants")
}`;

if (content.includes(after)) process.exit(0);
const count = content.split(before).length - 1;
if (count !== 1) throw new Error(`TeamSplitSession block expected once, found ${count}`);
await writeFile(path, content.replace(before, after));
