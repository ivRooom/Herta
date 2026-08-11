import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type SuggestionStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'completed';

export interface SuggestionSnapshot {
  id: string;
  guildId: string;
  authorId: string;
  channelId: string;
  messageId: string | null;
  content: string;
  anonymous: boolean;
  votingEnabled: boolean;
  status: SuggestionStatus;
  staffNote: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: Date;
}

export interface SuggestionListRecord {
  id: string;
  content: string;
  status: SuggestionStatus;
  createdAt: Date;
}

export async function createSuggestion(
  prisma: PrismaClient,
  input: {
    guildId: string;
    authorId: string;
    channelId: string;
    content: string;
    anonymous: boolean;
    votingEnabled: boolean;
    maxOpenPerUser: number;
  },
): Promise<string | null> {
  const id = randomUUID();
  return prisma.$transaction(async (tx) => {
    const lockKey = `suggestion:${input.guildId}:${input.authorId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "suggestions"
      WHERE "guild_id" = ${input.guildId}
        AND "author_id" = ${input.authorId}
        AND "status" IN ('pending', 'reviewing')
    `;
    if (Number(rows[0]?.count ?? 0n) >= input.maxOpenPerUser) return null;

    await tx.$executeRaw`
      INSERT INTO "suggestions" (
        "id", "guild_id", "author_id", "channel_id", "content", "anonymous",
        "voting_enabled", "status", "updated_at"
      ) VALUES (
        ${id}::uuid, ${input.guildId}, ${input.authorId}, ${input.channelId}, ${input.content},
        ${input.anonymous}, ${input.votingEnabled}, 'pending', CURRENT_TIMESTAMP
      )
    `;
    return id;
  });
}

export async function deleteSuggestion(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "suggestions" WHERE "id" = ${id}::uuid`;
}

export async function setSuggestionMessageId(
  prisma: PrismaClient,
  id: string,
  messageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "suggestions"
    SET "message_id" = ${messageId}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}::uuid
  `;
}

export async function getSuggestionSnapshot(
  prisma: PrismaClient,
  id: string,
  guildId: string,
): Promise<SuggestionSnapshot | null> {
  const rows = await prisma.$queryRaw<SuggestionSnapshot[]>`
    SELECT
      s."id"::text AS "id",
      s."guild_id" AS "guildId",
      s."author_id" AS "authorId",
      s."channel_id" AS "channelId",
      s."message_id" AS "messageId",
      s."content",
      s."anonymous",
      s."voting_enabled" AS "votingEnabled",
      s."status",
      s."staff_note" AS "staffNote",
      s."created_at" AS "createdAt",
      COUNT(*) FILTER (WHERE v."value" = 1)::int AS "upvotes",
      COUNT(*) FILTER (WHERE v."value" = -1)::int AS "downvotes"
    FROM "suggestions" s
    LEFT JOIN "suggestion_votes" v ON v."suggestion_id" = s."id"
    WHERE s."id" = ${id}::uuid AND s."guild_id" = ${guildId}
    GROUP BY s."id"
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listAuthorSuggestions(
  prisma: PrismaClient,
  guildId: string,
  authorId: string,
): Promise<SuggestionListRecord[]> {
  return prisma.$queryRaw<SuggestionListRecord[]>`
    SELECT
      "id"::text AS "id",
      "content",
      "status",
      "created_at" AS "createdAt"
    FROM "suggestions"
    WHERE "guild_id" = ${guildId} AND "author_id" = ${authorId}
    ORDER BY "created_at" DESC
    LIMIT 25
  `;
}

export async function voteSuggestion(
  prisma: PrismaClient,
  input: { id: string; guildId: string; userId: string; value: 1 | -1 },
): Promise<SuggestionSnapshot | null> {
  const accepted = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ votingEnabled: boolean }>>`
      SELECT "voting_enabled" AS "votingEnabled"
      FROM "suggestions"
      WHERE "id" = ${input.id}::uuid AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    if (!rows[0]?.votingEnabled) return false;
    await tx.$executeRaw`
      INSERT INTO "suggestion_votes" ("suggestion_id", "user_id", "value", "updated_at")
      VALUES (${input.id}::uuid, ${input.userId}, ${input.value}, CURRENT_TIMESTAMP)
      ON CONFLICT ("suggestion_id", "user_id") DO UPDATE
      SET "value" = CASE
        WHEN "suggestion_votes"."value" = EXCLUDED."value" THEN -EXCLUDED."value"
        ELSE EXCLUDED."value"
      END,
      "updated_at" = CURRENT_TIMESTAMP
    `;
    return true;
  });
  return accepted ? getSuggestionSnapshot(prisma, input.id, input.guildId) : null;
}

export async function updateSuggestionStatus(
  prisma: PrismaClient,
  input: {
    id: string;
    guildId: string;
    status: SuggestionStatus;
    staffNote: string | null;
  },
): Promise<SuggestionSnapshot | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "suggestions"
    SET "status" = ${input.status},
        "staff_note" = ${input.staffNote},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.id}::uuid AND "guild_id" = ${input.guildId}
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0 ? getSuggestionSnapshot(prisma, input.id, input.guildId) : null;
}
