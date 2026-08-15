import type { PrismaClient } from '@prisma/client';

export type CommunitySeasonAwardTier = 'champion' | 'top3' | 'top10';

export interface CommunitySeasonSnapshotWindowInput {
  key: string;
  index: number;
  startsAt: Date;
  endsAt: Date;
}

export interface CommunitySeasonSnapshotMetadata {
  guildId: string;
  seasonKey: string;
  seasonIndex: number;
  startsAt: Date;
  endsAt: Date;
  participantCount: number;
  sourceVersion: number;
  finalizedAt: Date;
}

export interface CommunitySeasonSnapshotAward {
  userId: string;
  rank: number;
  points: number;
  awardTier: CommunitySeasonAwardTier;
}

export interface CommunitySeasonSnapshotFinalizeResult {
  created: boolean;
  snapshot: CommunitySeasonSnapshotMetadata;
}

interface SnapshotMetadataRow {
  guildId: string;
  seasonKey: string;
  seasonIndex: number;
  startsAt: Date;
  endsAt: Date;
  participantCount: number;
  sourceVersion: number;
  finalizedAt: Date;
}

const SEASON_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DISCORD_ID_PATTERN = /^\d{1,32}$/;
const SOURCE_VERSION = 1;

export function communitySeasonAwardTierForRank(
  rank: number,
): CommunitySeasonAwardTier | null {
  if (!Number.isFinite(rank)) return null;
  const normalized = Math.trunc(rank);
  if (normalized === 1) return 'champion';
  if (normalized >= 2 && normalized <= 3) return 'top3';
  if (normalized >= 4 && normalized <= 10) return 'top10';
  return null;
}

export async function getCommunitySeasonSnapshotMetadata(
  prisma: PrismaClient,
  guildId: string,
  seasonKey: string,
): Promise<CommunitySeasonSnapshotMetadata | null> {
  const normalizedGuildId = requireGuildId(guildId);
  const normalizedSeasonKey = requireSeasonKey(seasonKey);
  const rows = await prisma.$queryRaw<SnapshotMetadataRow[]>`
    SELECT
      "guild_id" AS "guildId",
      "season_key" AS "seasonKey",
      "season_index" AS "seasonIndex",
      "starts_at" AS "startsAt",
      "ends_at" AS "endsAt",
      "participant_count" AS "participantCount",
      "source_version" AS "sourceVersion",
      "finalized_at" AS "finalizedAt"
    FROM "community_season_snapshots"
    WHERE "guild_id" = ${normalizedGuildId} AND "season_key" = ${normalizedSeasonKey}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listCommunitySeasonSnapshotAwards(
  prisma: PrismaClient,
  guildId: string,
  seasonKey: string,
): Promise<CommunitySeasonSnapshotAward[]> {
  const normalizedGuildId = requireGuildId(guildId);
  const normalizedSeasonKey = requireSeasonKey(seasonKey);
  return prisma.$queryRaw<CommunitySeasonSnapshotAward[]>`
    SELECT
      "user_id" AS "userId",
      "rank",
      "points",
      "award_tier" AS "awardTier"
    FROM "community_season_snapshot_entries"
    WHERE "guild_id" = ${normalizedGuildId}
      AND "season_key" = ${normalizedSeasonKey}
      AND "award_tier" IS NOT NULL
    ORDER BY "rank" ASC
    LIMIT 10
  `;
}

export async function listCommunitySeasonGuildIdsWithoutSnapshot(
  prisma: PrismaClient,
  seasonKey: string,
  limit = 100,
): Promise<string[]> {
  const normalizedSeasonKey = requireSeasonKey(seasonKey);
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 100;
  const rows = await prisma.$queryRaw<Array<{ guildId: string }>>`
    SELECT DISTINCT c."guild_id" AS "guildId"
    FROM "community_challenge_completions" c
    LEFT JOIN "community_season_snapshots" s
      ON s."guild_id" = c."guild_id" AND s."season_key" = c."season_key"
    WHERE c."season_key" = ${normalizedSeasonKey}
      AND s."guild_id" IS NULL
    ORDER BY c."guild_id" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => row.guildId);
}

export async function finalizeCommunitySeasonSnapshot(
  prisma: PrismaClient,
  input: {
    guildId: string;
    season: CommunitySeasonSnapshotWindowInput;
    now?: Date;
  },
): Promise<CommunitySeasonSnapshotFinalizeResult> {
  const guildId = requireGuildId(input.guildId);
  const season = normalizeSeasonWindow(input.season);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid Date');
  if (now.getTime() < season.endsAt.getTime()) {
    throw new Error('Current season cannot be finalized before its end');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`community-season-snapshot:${guildId}:${season.key}`}, 0)
      )
    `;

    const existingRows = await tx.$queryRaw<SnapshotMetadataRow[]>`
      SELECT
        "guild_id" AS "guildId",
        "season_key" AS "seasonKey",
        "season_index" AS "seasonIndex",
        "starts_at" AS "startsAt",
        "ends_at" AS "endsAt",
        "participant_count" AS "participantCount",
        "source_version" AS "sourceVersion",
        "finalized_at" AS "finalizedAt"
      FROM "community_season_snapshots"
      WHERE "guild_id" = ${guildId} AND "season_key" = ${season.key}
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (existing) return { created: false, snapshot: existing };

    const participantRows = await tx.$queryRaw<Array<{ participants: bigint }>>`
      SELECT COUNT(DISTINCT "user_id")::bigint AS "participants"
      FROM "community_challenge_completions"
      WHERE "guild_id" = ${guildId} AND "season_key" = ${season.key}
    `;
    const participantCount = Number(participantRows[0]?.participants ?? 0n);

    await tx.$executeRaw`
      INSERT INTO "community_season_snapshots" (
        "guild_id",
        "season_key",
        "season_index",
        "starts_at",
        "ends_at",
        "participant_count",
        "source_version"
      ) VALUES (
        ${guildId},
        ${season.key},
        ${season.index},
        ${season.startsAt},
        ${season.endsAt},
        ${participantCount},
        ${SOURCE_VERSION}
      )
    `;

    await tx.$executeRaw`
      WITH totals AS (
        SELECT "user_id", SUM("points")::bigint AS "total"
        FROM "community_challenge_completions"
        WHERE "guild_id" = ${guildId} AND "season_key" = ${season.key}
        GROUP BY "user_id"
      ), ranked AS (
        SELECT
          "user_id",
          "total",
          ROW_NUMBER() OVER (ORDER BY "total" DESC, "user_id" ASC)::int AS "rank"
        FROM totals
      )
      INSERT INTO "community_season_snapshot_entries" (
        "guild_id",
        "season_key",
        "user_id",
        "rank",
        "points",
        "award_tier"
      )
      SELECT
        ${guildId},
        ${season.key},
        "user_id",
        "rank",
        "total"::int,
        CASE
          WHEN "rank" = 1 THEN 'champion'
          WHEN "rank" <= 3 THEN 'top3'
          WHEN "rank" <= 10 THEN 'top10'
          ELSE NULL
        END
      FROM ranked
      ORDER BY "rank" ASC
    `;

    const createdRows = await tx.$queryRaw<SnapshotMetadataRow[]>`
      SELECT
        "guild_id" AS "guildId",
        "season_key" AS "seasonKey",
        "season_index" AS "seasonIndex",
        "starts_at" AS "startsAt",
        "ends_at" AS "endsAt",
        "participant_count" AS "participantCount",
        "source_version" AS "sourceVersion",
        "finalized_at" AS "finalizedAt"
      FROM "community_season_snapshots"
      WHERE "guild_id" = ${guildId} AND "season_key" = ${season.key}
      LIMIT 1
    `;
    const created = createdRows[0];
    if (!created) throw new Error('Season snapshot finalization did not create metadata');
    return { created: true, snapshot: created };
  });
}

function normalizeSeasonWindow(
  season: CommunitySeasonSnapshotWindowInput,
): CommunitySeasonSnapshotWindowInput {
  const key = requireSeasonKey(season.key);
  if (!Number.isFinite(season.index) || Math.trunc(season.index) < 1) {
    throw new Error('season index must be a positive integer');
  }
  if (!Number.isFinite(season.startsAt.getTime()) || !Number.isFinite(season.endsAt.getTime())) {
    throw new Error('season window must contain valid dates');
  }
  if (season.endsAt.getTime() <= season.startsAt.getTime()) {
    throw new Error('season end must be after season start');
  }
  return {
    key,
    index: Math.trunc(season.index),
    startsAt: new Date(season.startsAt),
    endsAt: new Date(season.endsAt),
  };
}

function requireSeasonKey(value: string): string {
  const normalized = value.trim();
  if (!SEASON_KEY_PATTERN.test(normalized)) throw new Error('Invalid season key');
  return normalized;
}

function requireGuildId(value: string): string {
  const normalized = value.trim();
  if (!DISCORD_ID_PATTERN.test(normalized)) throw new Error('Invalid guild id');
  return normalized;
}
