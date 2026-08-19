import type { PrismaClient } from '@prisma/client';

export interface BirthdayCardBackgroundMetadata {
  contentType: string;
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  updatedAt: Date;
}

export interface BirthdayCardBackgroundRecord extends BirthdayCardBackgroundMetadata {
  content: Buffer;
}

export async function getBirthdayCardBackgroundMetadata(
  prisma: PrismaClient,
  guildId: string,
): Promise<BirthdayCardBackgroundMetadata | null> {
  const rows = await prisma.$queryRaw<BirthdayCardBackgroundMetadata[]>`
    SELECT
      "content_type" AS "contentType",
      "file_name" AS "fileName",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "updated_at" AS "updatedAt"
    FROM "birthday_card_backgrounds"
    WHERE "guild_id" = ${guildId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getBirthdayCardBackground(
  prisma: PrismaClient,
  guildId: string,
): Promise<BirthdayCardBackgroundRecord | null> {
  const rows = await prisma.$queryRaw<BirthdayCardBackgroundRecord[]>`
    SELECT
      "content_type" AS "contentType",
      "file_name" AS "fileName",
      "content",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "updated_at" AS "updatedAt"
    FROM "birthday_card_backgrounds"
    WHERE "guild_id" = ${guildId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function upsertBirthdayCardBackground(
  prisma: PrismaClient,
  input: {
    guildId: string;
    contentType: string;
    fileName: string;
    content: Buffer;
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
    updatedBy: string;
  },
): Promise<BirthdayCardBackgroundMetadata> {
  const rows = await prisma.$queryRaw<BirthdayCardBackgroundMetadata[]>`
    INSERT INTO "birthday_card_backgrounds" (
      "guild_id",
      "content_type",
      "file_name",
      "content",
      "size_bytes",
      "width",
      "height",
      "sha256",
      "updated_by",
      "updated_at"
    ) VALUES (
      ${input.guildId},
      ${input.contentType},
      ${input.fileName},
      ${input.content},
      ${input.sizeBytes},
      ${input.width},
      ${input.height},
      ${input.sha256},
      ${input.updatedBy},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("guild_id") DO UPDATE SET
      "content_type" = EXCLUDED."content_type",
      "file_name" = EXCLUDED."file_name",
      "content" = EXCLUDED."content",
      "size_bytes" = EXCLUDED."size_bytes",
      "width" = EXCLUDED."width",
      "height" = EXCLUDED."height",
      "sha256" = EXCLUDED."sha256",
      "updated_by" = EXCLUDED."updated_by",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING
      "content_type" AS "contentType",
      "file_name" AS "fileName",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "updated_at" AS "updatedAt"
  `;
  const record = rows[0];
  if (!record) throw new Error('BirthdayCardBackgroundUpsertFailed');
  return record;
}

export async function deleteBirthdayCardBackground(
  prisma: PrismaClient,
  guildId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ guildId: string }>>`
    DELETE FROM "birthday_card_backgrounds"
    WHERE "guild_id" = ${guildId}
    RETURNING "guild_id" AS "guildId"
  `;
  return rows.length > 0;
}
