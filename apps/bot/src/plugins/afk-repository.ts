import type { PrismaClient } from '@herta/db';

export interface AfkStatusRecord {
  guildId: string;
  userId: string;
  reason: string;
  startedAt: Date;
}

export async function setAfkStatus(
  prisma: PrismaClient,
  input: { guildId: string; userId: string; reason: string },
): Promise<AfkStatusRecord> {
  const rows = await prisma.$queryRaw<AfkStatusRecord[]>`
    INSERT INTO "afk_statuses" ("guild_id", "user_id", "reason", "started_at", "updated_at")
    VALUES (${input.guildId}, ${input.userId}, ${input.reason}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("guild_id", "user_id") DO UPDATE
    SET "reason" = EXCLUDED."reason",
        "started_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    RETURNING
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "reason",
      "started_at" AS "startedAt"
  `;
  return rows[0]!;
}

export async function clearAfkStatus(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<AfkStatusRecord | null> {
  const rows = await prisma.$queryRaw<AfkStatusRecord[]>`
    DELETE FROM "afk_statuses"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    RETURNING
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "reason",
      "started_at" AS "startedAt"
  `;
  return rows[0] ?? null;
}

export async function getAfkStatus(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<AfkStatusRecord | null> {
  const rows = await prisma.$queryRaw<AfkStatusRecord[]>`
    SELECT
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "reason",
      "started_at" AS "startedAt"
    FROM "afk_statuses"
    WHERE "guild_id" = ${guildId} AND "user_id" = ${userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listGuildAfkStatuses(
  prisma: PrismaClient,
  guildId: string,
  limit = 25,
): Promise<AfkStatusRecord[]> {
  return prisma.$queryRaw<AfkStatusRecord[]>`
    SELECT
      "guild_id" AS "guildId",
      "user_id" AS "userId",
      "reason",
      "started_at" AS "startedAt"
    FROM "afk_statuses"
    WHERE "guild_id" = ${guildId}
    ORDER BY "started_at" DESC, "user_id" ASC
    LIMIT ${limit}
  `;
}
