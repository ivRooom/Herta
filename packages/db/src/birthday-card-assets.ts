import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export class BirthdayCardAssetLimitExceededError extends Error {
  constructor() {
    super('BirthdayCardAssetLimitExceeded');
    this.name = 'BirthdayCardAssetLimitExceededError';
  }
}

export class BirthdayCardAssetUploadRateLimitExceededError extends Error {
  constructor() {
    super('BirthdayCardAssetUploadRateLimitExceeded');
    this.name = 'BirthdayCardAssetUploadRateLimitExceededError';
  }
}

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

export function birthdayCardAssetGuildLockKey(guildId: string): string {
  return `birthday-card-assets:${guildId}`;
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
    maxAssets: number;
    uploadRateLimit: number;
    uploadRateWindowStart: Date;
  },
): Promise<BirthdayCardAssetMetadata> {
  return prisma.$transaction(async (tx) => {
    // A Guild-wide transaction lock intentionally serializes all Birthday Card uploads.
    // This is stronger than an actor-only lock and makes both the 24-asset cap and the
    // per-user upload rate limit atomic with the asset insert and its audit event.
    const lockKey = birthdayCardAssetGuildLockKey(input.guildId);
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    const recentUploads = await tx.auditLog.count({
      where: {
        guildId: input.guildId,
        actorId: input.createdBy,
        event: 'birthday_card.asset.created',
        createdAt: { gte: input.uploadRateWindowStart },
      },
    });
    if (recentUploads >= input.uploadRateLimit) {
      throw new BirthdayCardAssetUploadRateLimitExceededError();
    }

    const countRows = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::INTEGER AS "count"
      FROM "birthday_card_assets"
      WHERE "guild_id" = ${input.guildId}
    `;
    if ((countRows[0]?.count ?? 0) >= input.maxAssets) {
      throw new BirthdayCardAssetLimitExceededError();
    }

    const id = randomUUID();
    const rows = await tx.$queryRaw<BirthdayCardAssetMetadata[]>`
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

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.createdBy,
        event: 'birthday_card.asset.created',
        targetType: 'birthday_card_asset',
        targetId: record.id,
        metadata: {
          name: record.name,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          width: record.width,
          height: record.height,
          sha256: record.sha256,
          isPreset: record.isPreset,
        },
      },
    });

    return record;
  });
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
  return prisma.$transaction(async (tx) => {
    const lockKey = birthdayCardAssetGuildLockKey(input.guildId);
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    const rows = await tx.$queryRaw<BirthdayCardAssetMetadata[]>`
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
  });
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
