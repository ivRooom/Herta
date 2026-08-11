import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type GiveawayStatus = 'open' | 'closed';

export interface GiveawaySnapshot {
  id: string;
  guildId: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  prize: string;
  winnerCount: number;
  announceWinners: boolean;
  status: GiveawayStatus;
  endsAt: Date;
  closedAt: Date | null;
  entryCount: number;
  winners: string[];
}

export interface GiveawayListRecord {
  id: string;
  prize: string;
  status: GiveawayStatus;
  endsAt: Date;
  entryCount: number;
}

export interface GiveawayEntryResult {
  accepted: boolean;
  joined: boolean;
  entryCount: number;
  reason: 'ok' | 'not-found' | 'closed' | 'expired';
}

export async function createGiveaway(
  prisma: PrismaClient,
  input: {
    guildId: string;
    creatorId: string;
    channelId: string;
    prize: string;
    winnerCount: number;
    announceWinners: boolean;
    endsAt: Date;
  },
): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "giveaways" (
      "id", "guild_id", "creator_id", "channel_id", "prize", "winner_count",
      "announce_winners", "status", "ends_at", "updated_at"
    ) VALUES (
      ${id}::uuid, ${input.guildId}, ${input.creatorId}, ${input.channelId}, ${input.prize},
      ${input.winnerCount}, ${input.announceWinners}, 'open', ${input.endsAt}, CURRENT_TIMESTAMP
    )
  `;
  return id;
}

export async function deleteGiveaway(prisma: PrismaClient, giveawayId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "giveaways" WHERE "id" = ${giveawayId}::uuid`;
}

export async function setGiveawayMessageId(
  prisma: PrismaClient,
  giveawayId: string,
  messageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "giveaways"
    SET "message_id" = ${messageId}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${giveawayId}::uuid
  `;
}

export async function countActiveGiveaways(
  prisma: PrismaClient,
  guildId: string,
  creatorId: string,
  now = new Date(),
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "giveaways"
    WHERE "guild_id" = ${guildId}
      AND "creator_id" = ${creatorId}
      AND "status" = 'open'
      AND "ends_at" > ${now}
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function listCreatorGiveaways(
  prisma: PrismaClient,
  guildId: string,
  creatorId: string,
  now = new Date(),
): Promise<GiveawayListRecord[]> {
  return prisma.$queryRaw<GiveawayListRecord[]>`
    SELECT
      g."id"::text AS "id",
      g."prize",
      g."status",
      g."ends_at" AS "endsAt",
      COUNT(e."user_id")::bigint AS "entryCount"
    FROM "giveaways" g
    LEFT JOIN "giveaway_entries" e ON e."giveaway_id" = g."id"
    WHERE g."guild_id" = ${guildId}
      AND g."creator_id" = ${creatorId}
      AND (g."status" = 'open' OR g."ends_at" > ${new Date(now.getTime() - 24 * 60 * 60_000)})
    GROUP BY g."id"
    ORDER BY g."created_at" DESC
    LIMIT 25
  `;
}

export async function getGiveawaySnapshot(
  prisma: PrismaClient,
  giveawayId: string,
  guildId?: string,
): Promise<GiveawaySnapshot | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      guildId: string;
      creatorId: string;
      channelId: string;
      messageId: string | null;
      prize: string;
      winnerCount: number;
      announceWinners: boolean;
      status: GiveawayStatus;
      endsAt: Date;
      closedAt: Date | null;
      entryCount: bigint;
    }>
  >`
    SELECT
      g."id"::text AS "id",
      g."guild_id" AS "guildId",
      g."creator_id" AS "creatorId",
      g."channel_id" AS "channelId",
      g."message_id" AS "messageId",
      g."prize",
      g."winner_count" AS "winnerCount",
      g."announce_winners" AS "announceWinners",
      g."status",
      g."ends_at" AS "endsAt",
      g."closed_at" AS "closedAt",
      COUNT(e."user_id")::bigint AS "entryCount"
    FROM "giveaways" g
    LEFT JOIN "giveaway_entries" e ON e."giveaway_id" = g."id"
    WHERE g."id" = ${giveawayId}::uuid
      AND (${guildId ?? null}::text IS NULL OR g."guild_id" = ${guildId ?? null})
    GROUP BY g."id"
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const winners = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "user_id" AS "userId"
    FROM "giveaway_winners"
    WHERE "giveaway_id" = ${giveawayId}::uuid
    ORDER BY "position" ASC
  `;
  return {
    ...row,
    entryCount: Number(row.entryCount),
    winners: winners.map((winner) => winner.userId),
  };
}

export async function toggleGiveawayEntry(
  prisma: PrismaClient,
  input: { giveawayId: string; guildId: string; userId: string; now?: Date },
): Promise<GiveawayEntryResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ status: GiveawayStatus; endsAt: Date }>>`
      SELECT "status", "ends_at" AS "endsAt"
      FROM "giveaways"
      WHERE "id" = ${input.giveawayId}::uuid AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    const giveaway = rows[0];
    if (!giveaway) return rejectedEntry('not-found');
    if (giveaway.status !== 'open') return rejectedEntry('closed');
    if (giveaway.endsAt.getTime() <= now.getTime()) return rejectedEntry('expired');

    const existing = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM "giveaway_entries"
        WHERE "giveaway_id" = ${input.giveawayId}::uuid AND "user_id" = ${input.userId}
      ) AS "exists"
    `;
    const joined = !existing[0]?.exists;
    if (joined) {
      await tx.$executeRaw`
        INSERT INTO "giveaway_entries" ("giveaway_id", "user_id")
        VALUES (${input.giveawayId}::uuid, ${input.userId})
        ON CONFLICT DO NOTHING
      `;
    } else {
      await tx.$executeRaw`
        DELETE FROM "giveaway_entries"
        WHERE "giveaway_id" = ${input.giveawayId}::uuid AND "user_id" = ${input.userId}
      `;
    }
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "giveaway_entries"
      WHERE "giveaway_id" = ${input.giveawayId}::uuid
    `;
    return {
      accepted: true,
      joined,
      entryCount: Number(counts[0]?.count ?? 0n),
      reason: 'ok' as const,
    };
  });
}

export async function closeGiveawayByCreator(
  prisma: PrismaClient,
  giveawayId: string,
  guildId: string,
  creatorId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "giveaways"
    SET "status" = 'closed', "closed_at" = ${now}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${giveawayId}::uuid
      AND "guild_id" = ${guildId}
      AND "creator_id" = ${creatorId}
      AND "status" = 'open'
    RETURNING "id"::text AS "id"
  `;
  return rows.length > 0;
}

export async function closeExpiredGiveaways(
  prisma: PrismaClient,
  guildId: string,
  now = new Date(),
  limit = 25,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH due AS (
      SELECT "id"
      FROM "giveaways"
      WHERE "guild_id" = ${guildId}
        AND "status" = 'open'
        AND "ends_at" <= ${now}
      ORDER BY "ends_at" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "giveaways" g
    SET "status" = 'closed', "closed_at" = ${now}, "updated_at" = CURRENT_TIMESTAMP
    FROM due
    WHERE g."id" = due."id"
    RETURNING g."id"::text AS "id"
  `;
  return rows.map((row) => row.id);
}

export async function listGiveawayEntrants(
  prisma: PrismaClient,
  giveawayId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "user_id" AS "userId"
    FROM "giveaway_entries"
    WHERE "giveaway_id" = ${giveawayId}::uuid
    ORDER BY "created_at" ASC, "user_id" ASC
  `;
  return rows.map((row) => row.userId);
}

export async function replaceGiveawayWinners(
  prisma: PrismaClient,
  giveawayId: string,
  winnerIds: readonly string[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "giveaway_winners" WHERE "giveaway_id" = ${giveawayId}::uuid
    `;
    for (const [position, userId] of winnerIds.entries()) {
      await tx.$executeRaw`
        INSERT INTO "giveaway_winners" ("giveaway_id", "position", "user_id")
        VALUES (${giveawayId}::uuid, ${position}, ${userId})
      `;
    }
  });
}

function rejectedEntry(reason: GiveawayEntryResult['reason']): GiveawayEntryResult {
  return { accepted: false, joined: false, entryCount: 0, reason };
}
