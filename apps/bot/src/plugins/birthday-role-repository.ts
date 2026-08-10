import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export interface BirthdayRegistrationRecord {
  userId: string;
  month: number;
  day: number;
}

export interface BirthdayDeliveryRecord {
  id: string;
  status: string;
}

export interface BirthdayRoleAssignmentRecord {
  id: string;
  userId: string;
  localDate: string;
  kind: string;
}

export async function upsertBirthdayRegistration(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  month: number,
  day: number,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "birthday_registrations" (
      "guild_id", "user_id", "month", "day", "updated_at"
    ) VALUES (
      ${guildId}, ${userId}, ${month}, ${day}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("guild_id", "user_id") DO UPDATE SET
      "month" = EXCLUDED."month",
      "day" = EXCLUDED."day",
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

export async function deleteBirthdayRegistration(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "birthday_registrations"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
  `;
}

export async function getBirthdayRegistration(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<{ month: number; day: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ month: number; day: number }>>`
    SELECT "month", "day"
    FROM "birthday_registrations"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listBirthdayRegistrations(
  prisma: PrismaClient,
  guildId: string,
): Promise<BirthdayRegistrationRecord[]> {
  return prisma.$queryRaw<BirthdayRegistrationRecord[]>`
    SELECT "user_id" AS "userId", "month", "day"
    FROM "birthday_registrations"
    WHERE "guild_id" = ${guildId}
  `;
}

export async function listPendingBirthdayRoleAssignments(
  prisma: PrismaClient,
  guildId: string,
  currentLocalDate: string,
): Promise<BirthdayRoleAssignmentRecord[]> {
  const roleAssignmentPattern = 'role-assigned:%';
  return prisma.$queryRaw<BirthdayRoleAssignmentRecord[]>`
    SELECT
      "id",
      "user_id" AS "userId",
      "local_date" AS "localDate",
      "kind"
    FROM "birthday_deliveries"
    WHERE "guild_id" = ${guildId}
      AND "status" = 'completed'
      AND "kind" LIKE ${roleAssignmentPattern}
      AND "reconciled_at" IS NULL
      AND "local_date" < ${currentLocalDate}
    ORDER BY "local_date" ASC
  `;
}

export async function markBirthdayRoleAssignmentReconciled(
  prisma: PrismaClient,
  assignmentId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "birthday_deliveries"
    SET "reconciled_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${assignmentId}
  `;
}

export async function recoverStaleBirthdayDelivery(
  prisma: PrismaClient,
  idempotencyKey: string,
  staleBefore: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "birthday_deliveries"
    SET
      "status" = 'failed',
      "error_name" = 'StaleDelivery',
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "idempotency_key" = ${idempotencyKey}
      AND "status" = 'processing'
      AND "updated_at" < ${staleBefore}
  `;
}

export async function ensureBirthdayDelivery(
  prisma: PrismaClient,
  input: {
    guildId: string;
    userId: string;
    localDate: string;
    kind: string;
    idempotencyKey: string;
  },
): Promise<BirthdayDeliveryRecord> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "birthday_deliveries" (
      "id",
      "guild_id",
      "user_id",
      "local_date",
      "kind",
      "idempotency_key",
      "status",
      "updated_at"
    ) VALUES (
      ${id},
      ${input.guildId},
      ${input.userId},
      ${input.localDate},
      ${input.kind},
      ${input.idempotencyKey},
      'pending',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("idempotency_key") DO NOTHING
  `;

  const rows = await prisma.$queryRaw<BirthdayDeliveryRecord[]>`
    SELECT "id", "status"
    FROM "birthday_deliveries"
    WHERE "idempotency_key" = ${input.idempotencyKey}
    LIMIT 1
  `;
  const delivery = rows[0];
  if (!delivery) throw new Error('BirthdayDeliveryNotFound');
  return delivery;
}

export async function claimBirthdayDelivery(
  prisma: PrismaClient,
  deliveryId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "birthday_deliveries"
    SET "status" = 'processing', "error_name" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${deliveryId} AND "status" IN ('pending', 'failed')
    RETURNING "id"
  `;
  return rows.length > 0;
}

export async function completeBirthdayDelivery(
  prisma: PrismaClient,
  deliveryId: string,
  messageId: string | null,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "birthday_deliveries"
    SET
      "status" = 'completed',
      "message_id" = ${messageId},
      "error_name" = NULL,
      "completed_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${deliveryId}
  `;
}

export async function failBirthdayDelivery(
  prisma: PrismaClient,
  deliveryId: string,
  errorName: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "birthday_deliveries"
    SET "status" = 'failed', "error_name" = ${errorName}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${deliveryId}
  `;
}
