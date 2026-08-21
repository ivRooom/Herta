import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface BirthdayCardAssetMetadata {
  id: string;
  guildId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  isPreset: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BirthdayCardAssetRecord extends BirthdayCardAssetMetadata {
  content: Buffer;
}

export async function countBirthdayCardAssets(
  prisma: PrismaClient,
  guildId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::INTEGER AS "count"
    FROM "birthday_card_assets"
    WHERE "guild_id" = ${guildId}
  `;
  return rows[0]?.count ?? 0;
}

export async function listBirthdayCardAssetMetadata(
  prisma: PrismaClient,
  guildId: string,
): Promise<BirthdayCardAssetMetadata[]> {
  return prisma.$queryRaw<BirthdayCardAssetMetadata[]>`
    SELECT
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "birthday_card_assets"
    WHERE "guild_id" = ${guildId}
    ORDER BY "is_preset" DESC, "updated_at" DESC, "id" ASC
  `;
}

export async function getBirthdayCardAssetMetadata(
  prisma: PrismaClient,
  guildId: string,
  assetId: string,
): Promise<BirthdayCardAssetMetadata | null> {
  const rows = await prisma.$queryRaw<BirthdayCardAssetMetadata[]>`
    SELECT
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "birthday_card_assets"
    WHERE "guild_id" = ${guildId} AND "id" = ${assetId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getBirthdayCardAsset(
  prisma: PrismaClient,
  guildId: string,
  assetId: string,
): Promise<BirthdayCardAssetRecord | null> {
  const rows = await prisma.$queryRaw<BirthdayCardAssetRecord[]>`
    SELECT
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "content",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "birthday_card_assets"
    WHERE "guild_id" = ${guildId} AND "id" = ${assetId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createBirthdayCardAsset(
  prisma: PrismaClient,
  input: {
    guildId: string;
    name: string;
    contentType: string;
    content: Buffer;
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
    createdBy: string;
  },
): Promise<BirthdayCardAssetMetadata> {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<BirthdayCardAssetMetadata[]>`
    INSERT INTO "birthday_card_assets" (
      "id",
      "guild_id",
      "name",
      "content_type",
      "content",
      "size_bytes",
      "width",
      "height",
      "sha256",
      "is_preset",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at"
    ) VALUES (
      ${id},
      ${input.guildId},
      ${input.name},
      ${input.contentType},
      ${input.content},
      ${input.sizeBytes},
      ${input.width},
      ${input.height},
      ${input.sha256},
      FALSE,
      ${input.createdBy},
      ${input.createdBy},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  const record = rows[0];
  if (!record) throw new Error('BirthdayCardAssetCreateFailed');
  return record;
}

export async function renameBirthdayCardAsset(
  prisma: PrismaClient,
  input: { guildId: string; assetId: string; name: string; updatedBy: string },
): Promise<BirthdayCardAssetMetadata | null> {
  const rows = await prisma.$queryRaw<BirthdayCardAssetMetadata[]>`
    UPDATE "birthday_card_assets"
    SET
      "name" = ${input.name},
      "updated_by" = ${input.updatedBy},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "guild_id" = ${input.guildId} AND "id" = ${input.assetId}
    RETURNING
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  return rows[0] ?? null;
}

export async function setBirthdayCardAssetPreset(
  prisma: PrismaClient,
  input: { guildId: string; assetId: string; isPreset: boolean; updatedBy: string },
): Promise<BirthdayCardAssetMetadata | null> {
  const rows = await prisma.$queryRaw<BirthdayCardAssetMetadata[]>`
    UPDATE "birthday_card_assets"
    SET
      "is_preset" = ${input.isPreset},
      "updated_by" = ${input.updatedBy},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "guild_id" = ${input.guildId} AND "id" = ${input.assetId}
    RETURNING
      "id",
      "guild_id" AS "guildId",
      "name",
      "content_type" AS "contentType",
      "size_bytes" AS "sizeBytes",
      "width",
      "height",
      "sha256",
      "is_preset" AS "isPreset",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  return rows[0] ?? null;
}

export async function deleteBirthdayCardAsset(
  prisma: PrismaClient,
  guildId: string,
  assetId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM "birthday_card_assets"
    WHERE "guild_id" = ${guildId} AND "id" = ${assetId}
    RETURNING "id"
  `;
  return rows.length > 0;
}
