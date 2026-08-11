import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type ReminderDelivery = 'channel' | 'dm';

export interface ReminderRecord {
  id: string;
  userId: string;
  channelId: string | null;
  delivery: ReminderDelivery;
  message: string;
  remindAt: Date;
  status: string;
  attempts: number;
}

export async function createReminder(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    channelId: string | null;
    delivery: ReminderDelivery;
    message: string;
    remindAt: Date;
  },
): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "reminders" (
      "id", "guild_id", "user_id", "channel_id", "delivery", "message",
      "remind_at", "status", "attempts", "next_attempt_at", "updated_at"
    ) VALUES (
      ${id}::uuid, ${input.guildId}, ${input.userId}, ${input.channelId}, ${input.delivery},
      ${input.message}, ${input.remindAt}, 'pending', 0, ${input.remindAt}, CURRENT_TIMESTAMP
    )
  `;
  return id;
}

export async function countActiveReminders(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "reminders"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "status" IN ('pending', 'processing', 'failed')
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function listUserReminders(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<ReminderRecord[]> {
  return prisma.$queryRaw<ReminderRecord[]>`
    SELECT
      "id"::text AS "id",
      "user_id" AS "userId",
      "channel_id" AS "channelId",
      "delivery",
      "message",
      "remind_at" AS "remindAt",
      "status",
      "attempts"
    FROM "reminders"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "status" IN ('pending', 'processing', 'failed')
    ORDER BY "remind_at" ASC
    LIMIT 50
  `;
}

export async function cancelReminder(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  reminderId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "reminders"
    SET "status" = 'cancelled', "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${reminderId}::uuid
      AND "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "status" IN ('pending', 'failed')
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0;
}

export async function recoverStaleReminders(
  prisma: PrismaClient,
  guildId: string,
  staleBefore: Date,
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "reminders"
    SET
      "status" = 'failed',
      "error_name" = 'StaleDelivery',
      "next_attempt_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "guild_id" = ${guildId}
      AND "status" = 'processing'
      AND "updated_at" < ${staleBefore}
  `;
}

export async function listDueReminders(
  prisma: PrismaClient,
  guildId: string,
  now: Date,
  limit = 25,
): Promise<ReminderRecord[]> {
  return prisma.$queryRaw<ReminderRecord[]>`
    SELECT
      "id"::text AS "id",
      "user_id" AS "userId",
      "channel_id" AS "channelId",
      "delivery",
      "message",
      "remind_at" AS "remindAt",
      "status",
      "attempts"
    FROM "reminders"
    WHERE "guild_id" = ${guildId}
      AND "status" IN ('pending', 'failed')
      AND "remind_at" <= ${now}
      AND "next_attempt_at" <= ${now}
      AND "attempts" < 5
    ORDER BY "remind_at" ASC
    LIMIT ${limit}
  `;
}

export async function claimReminder(prisma: PrismaClient, reminderId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "reminders"
    SET
      "status" = 'processing',
      "attempts" = "attempts" + 1,
      "error_name" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${reminderId}::uuid
      AND "status" IN ('pending', 'failed')
      AND "attempts" < 5
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0;
}

export async function completeReminder(prisma: PrismaClient, reminderId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "reminders"
    SET
      "status" = 'delivered',
      "error_name" = NULL,
      "delivered_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${reminderId}::uuid
  `;
}

export async function failReminder(
  prisma: PrismaClient,
  reminderId: string,
  errorName: string,
  retryAt: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "reminders"
    SET
      "status" = 'failed',
      "error_name" = ${errorName},
      "next_attempt_at" = ${retryAt},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${reminderId}::uuid
  `;
}
