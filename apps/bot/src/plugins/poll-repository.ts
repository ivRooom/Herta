import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type PollResultStyle = 'count' | 'percentage';
export type PollStatus = 'open' | 'closed';

export interface PollOptionResult {
  position: number;
  label: string;
  votes: number;
}

export interface PollSnapshot {
  id: string;
  guildId: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  question: string;
  multiple: boolean;
  showLiveResults: boolean;
  resultStyle: PollResultStyle;
  closeAnnouncement: boolean;
  status: PollStatus;
  endsAt: Date;
  closedAt: Date | null;
  options: PollOptionResult[];
  totalVotes: number;
  uniqueVoters: number;
}

export interface PollListRecord {
  id: string;
  question: string;
  multiple: boolean;
  status: PollStatus;
  endsAt: Date;
}

export interface PollVoteResult {
  accepted: boolean;
  changed: boolean;
  selectedPositions: number[];
  reason: 'ok' | 'not-found' | 'closed' | 'expired' | 'invalid-option';
}

type PollTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export async function createPoll(
  prisma: PrismaClient,
  input: {
    guildId: string;
    creatorId: string;
    channelId: string;
    question: string;
    options: string[];
    multiple: boolean;
    showLiveResults: boolean;
    resultStyle: PollResultStyle;
    closeAnnouncement: boolean;
    endsAt: Date;
  },
): Promise<string> {
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "polls" (
        "id", "guild_id", "creator_id", "channel_id", "question", "multiple",
        "show_live_results", "result_style", "close_announcement", "status", "ends_at", "updated_at"
      ) VALUES (
        ${id}::uuid, ${input.guildId}, ${input.creatorId}, ${input.channelId}, ${input.question},
        ${input.multiple}, ${input.showLiveResults}, ${input.resultStyle}, ${input.closeAnnouncement},
        'open', ${input.endsAt}, CURRENT_TIMESTAMP
      )
    `;
    for (const [position, label] of input.options.entries()) {
      await tx.$executeRaw`
        INSERT INTO "poll_options" ("poll_id", "position", "label")
        VALUES (${id}::uuid, ${position}, ${label})
      `;
    }
  });
  return id;
}

export async function deletePoll(prisma: PrismaClient, pollId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "polls" WHERE "id" = ${pollId}::uuid`;
}

export async function setPollMessageId(
  prisma: PrismaClient,
  pollId: string,
  messageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "polls"
    SET "message_id" = ${messageId}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${pollId}::uuid
  `;
}

export async function countActivePolls(
  prisma: PrismaClient,
  guildId: string,
  creatorId: string,
  now = new Date(),
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "polls"
    WHERE "guild_id" = ${guildId}
      AND "creator_id" = ${creatorId}
      AND "status" = 'open'
      AND "ends_at" > ${now}
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function listCreatorPolls(
  prisma: PrismaClient,
  guildId: string,
  creatorId: string,
  now = new Date(),
): Promise<PollListRecord[]> {
  return prisma.$queryRaw<PollListRecord[]>`
    SELECT
      "id"::text AS "id",
      "question",
      "multiple",
      "status",
      "ends_at" AS "endsAt"
    FROM "polls"
    WHERE "guild_id" = ${guildId}
      AND "creator_id" = ${creatorId}
      AND ("status" = 'open' OR "ends_at" > ${new Date(now.getTime() - 24 * 60 * 60_000)})
    ORDER BY "created_at" DESC
    LIMIT 25
  `;
}

export async function getPollSnapshot(
  prisma: PrismaClient,
  pollId: string,
  guildId?: string,
): Promise<PollSnapshot | null> {
  const pollRows = await prisma.$queryRaw<
    Array<{
      id: string;
      guildId: string;
      creatorId: string;
      channelId: string;
      messageId: string | null;
      question: string;
      multiple: boolean;
      showLiveResults: boolean;
      resultStyle: PollResultStyle;
      closeAnnouncement: boolean;
      status: PollStatus;
      endsAt: Date;
      closedAt: Date | null;
    }>
  >`
    SELECT
      "id"::text AS "id",
      "guild_id" AS "guildId",
      "creator_id" AS "creatorId",
      "channel_id" AS "channelId",
      "message_id" AS "messageId",
      "question",
      "multiple",
      "show_live_results" AS "showLiveResults",
      "result_style" AS "resultStyle",
      "close_announcement" AS "closeAnnouncement",
      "status",
      "ends_at" AS "endsAt",
      "closed_at" AS "closedAt"
    FROM "polls"
    WHERE "id" = ${pollId}::uuid
      AND (${guildId ?? null}::text IS NULL OR "guild_id" = ${guildId ?? null})
    LIMIT 1
  `;
  const poll = pollRows[0];
  if (!poll) return null;

  const optionRows = await prisma.$queryRaw<
    Array<{ position: number; label: string; votes: bigint }>
  >`
    SELECT
      o."position",
      o."label",
      COUNT(v."user_id")::bigint AS "votes"
    FROM "poll_options" o
    LEFT JOIN "poll_votes" v
      ON v."poll_id" = o."poll_id" AND v."option_position" = o."position"
    WHERE o."poll_id" = ${pollId}::uuid
    GROUP BY o."position", o."label"
    ORDER BY o."position" ASC
  `;
  const voterRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT "user_id")::bigint AS "count"
    FROM "poll_votes"
    WHERE "poll_id" = ${pollId}::uuid
  `;
  const options = optionRows.map((option) => ({
    position: option.position,
    label: option.label,
    votes: Number(option.votes),
  }));
  return {
    ...poll,
    options,
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
    uniqueVoters: Number(voterRows[0]?.count ?? 0n),
  };
}

export async function votePoll(
  prisma: PrismaClient,
  input: {
    pollId: string;
    guildId: string;
    userId: string;
    optionPosition: number;
    now?: Date;
  },
): Promise<PollVoteResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const polls = await tx.$queryRaw<
      Array<{ multiple: boolean; status: PollStatus; endsAt: Date }>
    >`
      SELECT "multiple", "status", "ends_at" AS "endsAt"
      FROM "polls"
      WHERE "id" = ${input.pollId}::uuid AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    const poll = polls[0];
    if (!poll) return rejectedVote('not-found');
    if (poll.status !== 'open') return rejectedVote('closed');
    if (poll.endsAt.getTime() <= now.getTime()) return rejectedVote('expired');

    const options = await tx.$queryRaw<Array<{ position: number }>>`
      SELECT "position"
      FROM "poll_options"
      WHERE "poll_id" = ${input.pollId}::uuid AND "position" = ${input.optionPosition}
      LIMIT 1
    `;
    if (!options[0]) return rejectedVote('invalid-option');

    if (poll.multiple) {
      const existing = await tx.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS(
          SELECT 1 FROM "poll_votes"
          WHERE "poll_id" = ${input.pollId}::uuid
            AND "option_position" = ${input.optionPosition}
            AND "user_id" = ${input.userId}
        ) AS "exists"
      `;
      if (existing[0]?.exists) {
        await tx.$executeRaw`
          DELETE FROM "poll_votes"
          WHERE "poll_id" = ${input.pollId}::uuid
            AND "option_position" = ${input.optionPosition}
            AND "user_id" = ${input.userId}
        `;
      } else {
        await insertVote(tx, input.pollId, input.optionPosition, input.userId);
      }
    } else {
      const current = await tx.$queryRaw<Array<{ optionPosition: number }>>`
        SELECT "option_position" AS "optionPosition"
        FROM "poll_votes"
        WHERE "poll_id" = ${input.pollId}::uuid AND "user_id" = ${input.userId}
      `;
      const unchanged = current.length === 1 && current[0]?.optionPosition === input.optionPosition;
      if (!unchanged) {
        await tx.$executeRaw`
          DELETE FROM "poll_votes"
          WHERE "poll_id" = ${input.pollId}::uuid AND "user_id" = ${input.userId}
        `;
        await insertVote(tx, input.pollId, input.optionPosition, input.userId);
      }
    }

    const selected = await tx.$queryRaw<Array<{ optionPosition: number }>>`
      SELECT "option_position" AS "optionPosition"
      FROM "poll_votes"
      WHERE "poll_id" = ${input.pollId}::uuid AND "user_id" = ${input.userId}
      ORDER BY "option_position" ASC
    `;
    return {
      accepted: true,
      changed: true,
      selectedPositions: selected.map((entry) => entry.optionPosition),
      reason: 'ok',
    };
  });
}

export async function closePollByCreator(
  prisma: PrismaClient,
  pollId: string,
  guildId: string,
  creatorId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "polls"
    SET "status" = 'closed', "closed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${pollId}::uuid
      AND "guild_id" = ${guildId}
      AND "creator_id" = ${creatorId}
      AND "status" = 'open'
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0;
}

export async function closeExpiredPolls(
  prisma: PrismaClient,
  guildId: string,
  now = new Date(),
  limit = 25,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH due AS (
      SELECT "id"
      FROM "polls"
      WHERE "guild_id" = ${guildId}
        AND "status" = 'open'
        AND "ends_at" <= ${now}
      ORDER BY "ends_at" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "polls" p
    SET "status" = 'closed', "closed_at" = ${now}, "updated_at" = CURRENT_TIMESTAMP
    FROM due
    WHERE p."id" = due."id"
    RETURNING p."id"::text AS "id"
  `;
  return rows.map((row) => row.id);
}

async function insertVote(
  tx: PollTransaction,
  pollId: string,
  optionPosition: number,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "poll_votes" ("poll_id", "option_position", "user_id")
    VALUES (${pollId}::uuid, ${optionPosition}, ${userId})
    ON CONFLICT DO NOTHING
  `;
}

function rejectedVote(reason: PollVoteResult['reason']): PollVoteResult {
  return { accepted: false, changed: false, selectedPositions: [], reason };
}
