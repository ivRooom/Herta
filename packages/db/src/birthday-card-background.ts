import type { PrismaClient } from '@prisma/client';
import { getBirthdayCardAsset } from './birthday-card-assets.js';

const BIRTHDAY_CARD_ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

/** Legacy Guild custom background accessor used by the Studio card-background API. */
export async function getBirthdayCardBackground(
  prisma: PrismaClient,
  guildId: string,
): Promise<BirthdayCardBackgroundRecord | null> {
  return getLegacyBirthdayCardBackground(prisma, guildId);
}

/** Bot-only resolver. Asset Library selection is never exposed through the legacy HTTP accessor. */
export async function getBirthdayCardRuntimeBackground(
  prisma: PrismaClient,
  guildId: string,
  configSnapshot: unknown,
): Promise<BirthdayCardBackgroundRecord | null> {
  const assetSelection = resolveBirthdayCardAssetSelection(configSnapshot);
  if (assetSelection !== undefined) {
    if (!assetSelection) return null;
    const asset = await getBirthdayCardAsset(prisma, guildId, assetSelection);
    if (!asset) return null;
    return {
      contentType: asset.contentType,
      fileName: asset.name,
      content: asset.content,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
      updatedAt: asset.updatedAt,
    };
  }

  return getLegacyBirthdayCardBackground(prisma, guildId);
}

/**
 * undefined: Asset Libraryを選択していないため旧1枚背景を利用する。
 * null: Asset Libraryを選択しているがIDが不正なため安全に未登録扱いにする。
 * string: Guild scopeで取得するAsset ID。
 */
export function resolveBirthdayCardAssetSelection(value: unknown): string | null | undefined {
  if (!isRecord(value) || value['birthdayCardBackgroundSource'] !== 'asset') return undefined;
  const assetId = value['birthdayCardAssetId'];
  if (typeof assetId !== 'string') return null;
  const normalized = assetId.trim().toLowerCase();
  return BIRTHDAY_CARD_ASSET_ID_PATTERN.test(normalized) ? normalized : null;
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

async function getLegacyBirthdayCardBackground(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
