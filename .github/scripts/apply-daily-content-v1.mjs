import { readFile, writeFile } from 'node:fs/promises';

async function replaceExactly(path, before, after) {
  const content = await readFile(path, 'utf8');
  if (content.includes(after)) return;
  const count = content.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${path}: expected source block count 1, received ${count}`);
  }
  await writeFile(path, content.replace(before, after));
}

await replaceExactly(
  'packages/db/prisma/schema.prisma',
  `model DailyContent {
  id           String    @id @default(uuid())
  guildId      String    @map("guild_id")
  channelId    String    @map("channel_id")
  title        String    @default("")
  content      String
  scheduleTime String    @map("schedule_time")
  timezone     String    @default("Asia/Tokyo")
  enabled      Boolean   @default(true)
  lastSentAt   DateTime? @map("last_sent_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@index([guildId, enabled])
  @@map("daily_contents")
}
`,
  `model DailyContent {
  id              String    @id @default(uuid())
  guildId         String    @map("guild_id")
  channelId       String    @map("channel_id")
  title           String    @default("")
  content         String
  scheduleTime    String    @map("schedule_time")
  timezone        String    @default("Asia/Tokyo")
  enabled         Boolean   @default(true)
  nextRunAt       DateTime? @map("next_run_at") @db.Timestamptz(3)
  lastScheduledAt DateTime? @map("last_scheduled_at") @db.Timestamptz(3)
  lastSentAt      DateTime? @map("last_sent_at") @db.Timestamptz(3)
  createdBy       String?   @map("created_by")
  updatedBy       String?   @map("updated_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  deliveries DailyContentDelivery[]

  @@index([guildId, enabled])
  @@index([enabled, nextRunAt])
  @@map("daily_contents")
}

model DailyContentDelivery {
  id             String    @id @default(uuid())
  dailyContentId String    @map("daily_content_id")
  guildId        String    @map("guild_id")
  idempotencyKey String    @unique @map("idempotency_key")
  origin         String    @default("scheduled")
  scheduledFor   DateTime  @map("scheduled_for") @db.Timestamptz(3)
  status         String    @default("pending")
  attemptCount   Int       @default(0) @map("attempt_count")
  messageId      String?   @map("message_id")
  errorName      String?   @map("error_name")
  queuedAt       DateTime? @map("queued_at") @db.Timestamptz(3)
  startedAt      DateTime? @map("started_at") @db.Timestamptz(3)
  nextAttemptAt  DateTime? @map("next_attempt_at") @db.Timestamptz(3)
  sentAt         DateTime? @map("sent_at") @db.Timestamptz(3)
  failedAt       DateTime? @map("failed_at") @db.Timestamptz(3)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  dailyContent DailyContent @relation(fields: [dailyContentId], references: [id], onDelete: Cascade)

  @@index([guildId, createdAt(sort: Desc)])
  @@index([status, nextAttemptAt])
  @@index([dailyContentId, scheduledFor(sort: Desc)])
  @@map("daily_content_deliveries")
}
`,
);

const workerPath = 'apps/worker/src/daily-content.ts';
let worker = await readFile(workerPath, 'utf8');
if (!worker.includes('nextDailyOccurrence,')) {
  worker = worker.replace(
    `  normalizeDailyContentConfig,\n`,
    `  nextDailyOccurrence,\n  normalizeDailyContentConfig,\n`,
  );
}
if (!worker.includes('await initializeMissingNextRuns(options.prisma, now);')) {
  worker = worker.replace(
    `    try {\n      await recoverStale(prisma, now, options.logger);`,
    `    try {\n      await initializeMissingNextRuns(options.prisma, now);\n      await recoverStale(prisma, now, options.logger);`,
  );
}
if (!worker.includes('async function initializeMissingNextRuns(')) {
  worker = worker.replace(
    `async function recoverStale(\n`,
    `async function initializeMissingNextRuns(prisma: PrismaClient, now: Date): Promise<void> {\n  const schedules = await prisma.dailyContent.findMany({\n    where: { enabled: true, nextRunAt: null },\n    select: { id: true, scheduleTime: true, timezone: true },\n    take: DAILY_CONTENT_SCAN_LIMIT,\n  });\n  for (const schedule of schedules) {\n    const nextRunAt = nextDailyOccurrence({\n      scheduleTime: schedule.scheduleTime,\n      timezone: schedule.timezone,\n      after: now,\n    });\n    await prisma.dailyContent.update({\n      where: { id: schedule.id },\n      data: { nextRunAt },\n    });\n  }\n}\n\nasync function recoverStale(\n`,
  );
}
await writeFile(workerPath, worker);

const managerPath = 'apps/studio/src/components/daily-content-manager.tsx';
let manager = await readFile(managerPath, 'utf8');
manager = manager.replace(
  `import { useEffect, useMemo, useState, type FormEvent } from 'react';`,
  `import { cloneElement, useEffect, useMemo, useState, type FormEvent } from 'react';`,
);
if (!manager.includes('const INPUT_CLASS_NAME =')) {
  manager = manager.replace(
    `const EMPTY_FORM: DailyContentFormState = {`,
    `const INPUT_CLASS_NAME =\n  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';\n\nconst EMPTY_FORM: DailyContentFormState = {`,
  );
}
manager = manager.replaceAll(`className="input"`, `className={INPUT_CLASS_NAME}`);
manager = manager.replace(
  `className="input mt-1 resize-y"`,
  `className={\`${'${INPUT_CLASS_NAME}'} mt-1 resize-y\`}`,
);
manager = manager.replace(
  `{icon.type({ ...icon.props, className: 'h-3.5 w-3.5' })}`,
  `{cloneElement(icon, { className: 'h-3.5 w-3.5' })}`,
);
await writeFile(managerPath, manager);
