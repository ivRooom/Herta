import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type SuggestionStatus =
  'pending' | 'reviewing' | 'accepted' | 'rejected' | 'completed' | 'withdrawn';
export type ManagedSuggestionStatus = 'reviewing' | 'accepted' | 'rejected' | 'completed';
export type SuggestionQueueFilter = 'open' | SuggestionStatus | 'all';

export const SUGGESTION_QUEUE_PAGE_SIZE = 7;
export const SUGGESTION_QUEUE_MAX_PAGE = 100;

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

export interface SuggestionQueueRecord {
  id: string;
  authorId: string;
  content: string;
  anonymous: boolean;
  status: SuggestionStatus;
  upvotes: number;
  downvotes: number;
  createdAt: Date;
}

export interface SuggestionQueuePage {
  records: SuggestionQueueRecord[];
  hasNext: boolean;
}

export type WithdrawSuggestionOutcome =
  'withdrawn' | 'already_withdrawn' | 'not_found_or_forbidden' | 'not_withdrawable';

export interface WithdrawSuggestionResult {
  outcome: WithdrawSuggestionOutcome;
  snapshot: SuggestionSnapshot | null;
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

export async function listSuggestionQueue(
  prisma: PrismaClient,
  input: { guildId: string; filter: SuggestionQueueFilter; page: number },
): Promise<SuggestionQueuePage> {
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > SUGGESTION_QUEUE_MAX_PAGE) {
    throw new RangeError('SuggestionQueuePageOutOfRange');
  }

  const offset = (input.page - 1) * SUGGESTION_QUEUE_PAGE_SIZE;
  const limit = SUGGESTION_QUEUE_PAGE_SIZE + 1;
  let rows: SuggestionQueueRecord[];

  if (input.filter === 'open') {
    rows = await prisma.$queryRaw<SuggestionQueueRecord[]>`
      WITH page AS (
        SELECT
          s."id",
          s."author_id",
          s."content",
          s."anonymous",
          s."status",
          s."created_at"
        FROM "suggestions" s
        WHERE s."guild_id" = ${input.guildId}
          AND s."status" IN ('pending', 'reviewing')
        ORDER BY s."created_at" DESC, s."id" DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT
        page."id"::text AS "id",
        page."author_id" AS "authorId",
        page."content",
        page."anonymous",
        page."status",
        page."created_at" AS "createdAt",
        COUNT(*) FILTER (WHERE v."value" = 1)::int AS "upvotes",
        COUNT(*) FILTER (WHERE v."value" = -1)::int AS "downvotes"
      FROM page
      LEFT JOIN "suggestion_votes" v ON v."suggestion_id" = page."id"
      GROUP BY
        page."id",
        page."author_id",
        page."content",
        page."anonymous",
        page."status",
        page."created_at"
      ORDER BY page."created_at" DESC, page."id" DESC
    `;
  } else if (input.filter === 'all') {
    rows = await prisma.$queryRaw<SuggestionQueueRecord[]>`
      WITH page AS (
        SELECT
          s."id",
          s."author_id",
          s."content",
          s."anonymous",
          s."status",
          s."created_at"
        FROM "suggestions" s
        WHERE s."guild_id" = ${input.guildId}
        ORDER BY s."created_at" DESC, s."id" DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT
        page."id"::text AS "id",
        page."author_id" AS "authorId",
        page."content",
        page."anonymous",
        page."status",
        page."created_at" AS "createdAt",
        COUNT(*) FILTER (WHERE v."value" = 1)::int AS "upvotes",
        COUNT(*) FILTER (WHERE v."value" = -1)::int AS "downvotes"
      FROM page
      LEFT JOIN "suggestion_votes" v ON v."suggestion_id" = page."id"
      GROUP BY
        page."id",
        page."author_id",
        page."content",
        page."anonymous",
        page."status",
        page."created_at"
      ORDER BY page."created_at" DESC, page."id" DESC
    `;
  } else {
    rows = await prisma.$queryRaw<SuggestionQueueRecord[]>`
      WITH page AS (
        SELECT
          s."id",
          s."author_id",
          s."content",
          s."anonymous",
          s."status",
          s."created_at"
        FROM "suggestions" s
        WHERE s."guild_id" = ${input.guildId}
          AND s."status" = ${input.filter}
        ORDER BY s."created_at" DESC, s."id" DESC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT
        page."id"::text AS "id",
        page."author_id" AS "authorId",
        page."content",
        page."anonymous",
        page."status",
        page."created_at" AS "createdAt",
        COUNT(*) FILTER (WHERE v."value" = 1)::int AS "upvotes",
        COUNT(*) FILTER (WHERE v."value" = -1)::int AS "downvotes"
      FROM page
      LEFT JOIN "suggestion_votes" v ON v."suggestion_id" = page."id"
      GROUP BY
        page."id",
        page."author_id",
        page."content",
        page."anonymous",
        page."status",
        page."created_at"
      ORDER BY page."created_at" DESC, page."id" DESC
    `;
  }

  return {
    records: rows.slice(0, SUGGESTION_QUEUE_PAGE_SIZE),
    hasNext: rows.length > SUGGESTION_QUEUE_PAGE_SIZE,
  };
}

export async function withdrawSuggestion(
  prisma: PrismaClient,
  input: { id: string; guildId: string; authorId: string },
): Promise<WithdrawSuggestionResult> {
  const outcome = await prisma.$transaction(async (tx): Promise<WithdrawSuggestionOutcome> => {
    const rows = await tx.$queryRaw<Array<{ authorId: string; status: SuggestionStatus }>>`
        SELECT "author_id" AS "authorId", "status"
        FROM "suggestions"
        WHERE "id" = ${input.id}::uuid AND "guild_id" = ${input.guildId}
        FOR UPDATE
      `;
    const suggestion = rows[0];
    if (!suggestion || suggestion.authorId !== input.authorId) return 'not_found_or_forbidden';
    if (suggestion.status === 'withdrawn') return 'already_withdrawn';
    if (suggestion.status !== 'pending' && suggestion.status !== 'reviewing') {
      return 'not_withdrawable';
    }

    await tx.$executeRaw`
        UPDATE "suggestions"
        SET "status" = 'withdrawn', "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.id}::uuid
          AND "guild_id" = ${input.guildId}
          AND "author_id" = ${input.authorId}
          AND "status" IN ('pending', 'reviewing')
      `;
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.authorId,
        event: 'suggestion.withdraw',
        targetType: 'suggestion',
        targetId: input.id,
        changes: {
          before: { status: suggestion.status },
          after: { status: 'withdrawn' },
        },
        metadata: { operationSource: 'discord' },
      },
    });
    return 'withdrawn';
  });

  const snapshot =
    outcome === 'withdrawn' || outcome === 'already_withdrawn'
      ? await getSuggestionSnapshot(prisma, input.id, input.guildId)
      : null;
  return { outcome, snapshot };
}

export async function voteSuggestion(
  prisma: PrismaClient,
  input: { id: string; guildId: string; userId: string; value: 1 | -1 },
): Promise<SuggestionSnapshot | null> {
  const accepted = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ votingEnabled: boolean; status: SuggestionStatus }>>`
      SELECT "voting_enabled" AS "votingEnabled", "status"
      FROM "suggestions"
      WHERE "id" = ${input.id}::uuid AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    const suggestion = rows[0];
    if (
      !suggestion?.votingEnabled ||
      (suggestion.status !== 'pending' && suggestion.status !== 'reviewing')
    ) {
      return false;
    }

    const existing = await tx.$queryRaw<Array<{ value: number }>>`
      SELECT "value"::int AS "value"
      FROM "suggestion_votes"
      WHERE "suggestion_id" = ${input.id}::uuid AND "user_id" = ${input.userId}
      LIMIT 1
    `;
    if (existing[0]?.value === input.value) {
      await tx.$executeRaw`
        DELETE FROM "suggestion_votes"
        WHERE "suggestion_id" = ${input.id}::uuid AND "user_id" = ${input.userId}
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO "suggestion_votes" ("suggestion_id", "user_id", "value", "updated_at")
        VALUES (${input.id}::uuid, ${input.userId}, ${input.value}, CURRENT_TIMESTAMP)
        ON CONFLICT ("suggestion_id", "user_id") DO UPDATE
        SET "value" = EXCLUDED."value", "updated_at" = CURRENT_TIMESTAMP
      `;
    }
    return true;
  });
  return accepted ? getSuggestionSnapshot(prisma, input.id, input.guildId) : null;
}

export async function updateSuggestionStatus(
  prisma: PrismaClient,
  input: {
    id: string;
    guildId: string;
    status: ManagedSuggestionStatus;
    staffNote: string | null;
  },
): Promise<SuggestionSnapshot | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "suggestions"
    SET "status" = ${input.status},
        "staff_note" = ${input.staffNote},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.id}::uuid
      AND "guild_id" = ${input.guildId}
      AND "status" <> 'withdrawn'
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0 ? getSuggestionSnapshot(prisma, input.id, input.guildId) : null;
}
