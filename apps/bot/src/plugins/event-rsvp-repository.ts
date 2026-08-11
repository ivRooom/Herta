import type { PrismaClient } from '@herta/db';
import { randomUUID } from 'node:crypto';

export type EventStatus = 'open' | 'closed' | 'cancelled';
export type RsvpStatus = 'going' | 'maybe' | 'declined' | 'waitlist';

export interface EventSnapshot {
  id: string;
  guildId: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  timezone: string;
  startsAt: Date;
  registrationClosesAt: Date;
  capacity: number | null;
  status: EventStatus;
  allowMaybe: boolean;
  allowWaitlist: boolean;
  reminderMinutes: number;
  reminderSentAt: Date | null;
  finalizedAt: Date | null;
  goingCount: number;
  maybeCount: number;
  declinedCount: number;
  waitlistCount: number;
}

export interface EventListRecord {
  id: string;
  title: string;
  startsAt: Date;
  status: EventStatus;
  goingCount: number;
  capacity: number | null;
}

export interface ClaimedEventReminder {
  id: string;
  guildId: string;
  channelId: string;
  title: string;
  startsAt: Date;
  location: string | null;
}

export interface RsvpResult {
  ok: boolean;
  reason?: 'closed' | 'full' | 'maybe-disabled' | 'not-found';
  status?: RsvpStatus | 'removed';
  promotedUserId?: string;
}

export async function createCommunityEvent(
  prisma: PrismaClient,
  input: {
    guildId: string;
    creatorId: string;
    channelId: string;
    title: string;
    description: string | null;
    location: string | null;
    timezone: string;
    startsAt: Date;
    registrationClosesAt: Date;
    capacity: number | null;
    allowMaybe: boolean;
    allowWaitlist: boolean;
    reminderMinutes: number;
    maxActivePerUser: number;
  },
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event-rsvp:${input.guildId}:${input.creatorId}`}))`;
    const [countRow] = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "community_events"
      WHERE "guild_id" = ${input.guildId}
        AND "creator_id" = ${input.creatorId}
        AND "status" IN ('open', 'closed')
        AND "starts_at" > CURRENT_TIMESTAMP
    `;
    if (Number(countRow?.count ?? 0n) >= input.maxActivePerUser) return null;

    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "community_events" (
        "id", "guild_id", "creator_id", "channel_id", "title", "description",
        "location", "timezone", "starts_at", "registration_closes_at", "capacity",
        "allow_maybe", "allow_waitlist", "reminder_minutes"
      ) VALUES (
        ${id}::uuid, ${input.guildId}, ${input.creatorId}, ${input.channelId}, ${input.title},
        ${input.description}, ${input.location}, ${input.timezone}, ${input.startsAt},
        ${input.registrationClosesAt}, ${input.capacity}, ${input.allowMaybe},
        ${input.allowWaitlist}, ${input.reminderMinutes}
      )
    `;
    return id;
  });
}

export async function setCommunityEventMessageId(
  prisma: PrismaClient,
  eventId: string,
  messageId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "community_events"
    SET "message_id" = ${messageId}, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${eventId}::uuid
  `;
}

export async function deleteCommunityEvent(prisma: PrismaClient, eventId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "community_events" WHERE "id" = ${eventId}::uuid`;
}

export async function getCommunityEventSnapshot(
  prisma: PrismaClient,
  eventId: string,
  guildId: string,
): Promise<EventSnapshot | null> {
  const [row] = await prisma.$queryRaw<
    Array<{
      id: string;
      guildId: string;
      creatorId: string;
      channelId: string;
      messageId: string | null;
      title: string;
      description: string | null;
      location: string | null;
      timezone: string;
      startsAt: Date;
      registrationClosesAt: Date;
      capacity: number | null;
      status: EventStatus;
      allowMaybe: boolean;
      allowWaitlist: boolean;
      reminderMinutes: number;
      reminderSentAt: Date | null;
      finalizedAt: Date | null;
      goingCount: bigint;
      maybeCount: bigint;
      declinedCount: bigint;
      waitlistCount: bigint;
    }>
  >`
    SELECT
      e."id"::text AS id,
      e."guild_id" AS "guildId",
      e."creator_id" AS "creatorId",
      e."channel_id" AS "channelId",
      e."message_id" AS "messageId",
      e."title",
      e."description",
      e."location",
      e."timezone",
      e."starts_at" AS "startsAt",
      e."registration_closes_at" AS "registrationClosesAt",
      e."capacity",
      e."status",
      e."allow_maybe" AS "allowMaybe",
      e."allow_waitlist" AS "allowWaitlist",
      e."reminder_minutes" AS "reminderMinutes",
      e."reminder_sent_at" AS "reminderSentAt",
      e."finalized_at" AS "finalizedAt",
      COUNT(*) FILTER (WHERE r."status" = 'going')::bigint AS "goingCount",
      COUNT(*) FILTER (WHERE r."status" = 'maybe')::bigint AS "maybeCount",
      COUNT(*) FILTER (WHERE r."status" = 'declined')::bigint AS "declinedCount",
      COUNT(*) FILTER (WHERE r."status" = 'waitlist')::bigint AS "waitlistCount"
    FROM "community_events" e
    LEFT JOIN "event_rsvps" r ON r."event_id" = e."id"
    WHERE e."id" = ${eventId}::uuid AND e."guild_id" = ${guildId}
    GROUP BY e."id"
  `;
  if (!row) return null;
  return {
    ...row,
    goingCount: Number(row.goingCount),
    maybeCount: Number(row.maybeCount),
    declinedCount: Number(row.declinedCount),
    waitlistCount: Number(row.waitlistCount),
  };
}

export async function listUpcomingCommunityEvents(
  prisma: PrismaClient,
  guildId: string,
  limit = 20,
): Promise<EventListRecord[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      startsAt: Date;
      status: EventStatus;
      goingCount: bigint;
      capacity: number | null;
    }>
  >`
    SELECT
      e."id"::text AS id,
      e."title",
      e."starts_at" AS "startsAt",
      e."status",
      e."capacity",
      COUNT(*) FILTER (WHERE r."status" = 'going')::bigint AS "goingCount"
    FROM "community_events" e
    LEFT JOIN "event_rsvps" r ON r."event_id" = e."id"
    WHERE e."guild_id" = ${guildId}
      AND e."status" <> 'cancelled'
      AND e."starts_at" > CURRENT_TIMESTAMP
    GROUP BY e."id"
    ORDER BY e."starts_at" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ ...row, goingCount: Number(row.goingCount) }));
}

export async function updateEventRsvp(
  prisma: PrismaClient,
  input: {
    eventId: string;
    guildId: string;
    userId: string;
    requestedStatus: 'going' | 'maybe' | 'declined';
  },
): Promise<RsvpResult> {
  return prisma.$transaction(async (tx) => {
    const [event] = await tx.$queryRaw<
      Array<{
        status: EventStatus;
        capacity: number | null;
        allowMaybe: boolean;
        allowWaitlist: boolean;
        registrationClosesAt: Date;
      }>
    >`
      SELECT
        "status", "capacity", "allow_maybe" AS "allowMaybe",
        "allow_waitlist" AS "allowWaitlist",
        "registration_closes_at" AS "registrationClosesAt"
      FROM "community_events"
      WHERE "id" = ${input.eventId}::uuid AND "guild_id" = ${input.guildId}
      FOR UPDATE
    `;
    if (!event) return { ok: false, reason: 'not-found' };
    if (event.status !== 'open' || event.registrationClosesAt.getTime() <= Date.now()) {
      return { ok: false, reason: 'closed' };
    }
    if (input.requestedStatus === 'maybe' && !event.allowMaybe) {
      return { ok: false, reason: 'maybe-disabled' };
    }

    const [existing] = await tx.$queryRaw<Array<{ status: RsvpStatus }>>`
      SELECT "status" FROM "event_rsvps"
      WHERE "event_id" = ${input.eventId}::uuid AND "user_id" = ${input.userId}
    `;
    const wasGoing = existing?.status === 'going';
    if (existing?.status === input.requestedStatus) {
      await tx.$executeRaw`
        DELETE FROM "event_rsvps"
        WHERE "event_id" = ${input.eventId}::uuid AND "user_id" = ${input.userId}
      `;
      const promotedUserId = wasGoing ? await promoteWaitlist(tx, input.eventId) : undefined;
      return { ok: true, status: 'removed', promotedUserId };
    }

    let nextStatus: RsvpStatus = input.requestedStatus;
    if (input.requestedStatus === 'going' && event.capacity !== null) {
      const [countRow] = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "event_rsvps"
        WHERE "event_id" = ${input.eventId}::uuid
          AND "status" = 'going'
          AND "user_id" <> ${input.userId}
      `;
      if (Number(countRow?.count ?? 0n) >= event.capacity) {
        if (!event.allowWaitlist) return { ok: false, reason: 'full' };
        nextStatus = 'waitlist';
      }
    }

    await tx.$executeRaw`
      INSERT INTO "event_rsvps" ("event_id", "user_id", "status")
      VALUES (${input.eventId}::uuid, ${input.userId}, ${nextStatus})
      ON CONFLICT ("event_id", "user_id") DO UPDATE
      SET "status" = EXCLUDED."status", "updated_at" = CURRENT_TIMESTAMP
    `;
    const promotedUserId =
      wasGoing && nextStatus !== 'going' ? await promoteWaitlist(tx, input.eventId) : undefined;
    return { ok: true, status: nextStatus, promotedUserId };
  });
}

async function promoteWaitlist(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  eventId: string,
): Promise<string | undefined> {
  const [row] = await prisma.$queryRaw<Array<{ userId: string }>>`
    UPDATE "event_rsvps"
    SET "status" = 'going', "updated_at" = CURRENT_TIMESTAMP
    WHERE ("event_id", "user_id") = (
      SELECT "event_id", "user_id" FROM "event_rsvps"
      WHERE "event_id" = ${eventId}::uuid AND "status" = 'waitlist'
      ORDER BY "created_at" ASC, "user_id" ASC
      LIMIT 1
    )
    RETURNING "user_id" AS "userId"
  `;
  return row?.userId;
}

export async function listGoingUserIds(prisma: PrismaClient, eventId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "user_id" AS "userId" FROM "event_rsvps"
    WHERE "event_id" = ${eventId}::uuid AND "status" = 'going'
    ORDER BY "created_at" ASC
  `;
  return rows.map((row) => row.userId);
}

export async function cancelCommunityEvent(
  prisma: PrismaClient,
  eventId: string,
  guildId: string,
): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE "community_events"
    SET "status" = 'cancelled', "finalized_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${eventId}::uuid AND "guild_id" = ${guildId}
      AND "status" <> 'cancelled' AND "starts_at" > CURRENT_TIMESTAMP
  `;
  return changed > 0;
}

export async function closeExpiredCommunityEvents(
  prisma: PrismaClient,
  guildId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "community_events"
    SET "status" = 'closed', "finalized_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" IN (
      SELECT "id" FROM "community_events"
      WHERE "guild_id" = ${guildId}
        AND "status" = 'open'
        AND "registration_closes_at" <= CURRENT_TIMESTAMP
      FOR UPDATE SKIP LOCKED
      LIMIT 20
    )
    RETURNING "id"::text AS id
  `;
  return rows.map((row) => row.id);
}

export async function listEventsPendingFinalization(
  prisma: PrismaClient,
  guildId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS id FROM "community_events"
    WHERE "guild_id" = ${guildId}
      AND "status" IN ('closed', 'cancelled')
      AND "message_id" IS NOT NULL
      AND "finalized_at" IS NULL
    ORDER BY "updated_at" ASC
    LIMIT 20
  `;
  return rows.map((row) => row.id);
}

export async function markCommunityEventFinalized(
  prisma: PrismaClient,
  eventId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "community_events"
    SET "finalized_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${eventId}::uuid
  `;
}

export async function claimDueEventReminders(
  prisma: PrismaClient,
  guildId: string,
  limit = 10,
): Promise<ClaimedEventReminder[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedEventReminder[]>`
      WITH due AS (
        SELECT "id" FROM "community_events"
        WHERE "guild_id" = ${guildId}
          AND "status" IN ('open', 'closed')
          AND "reminder_minutes" > 0
          AND "reminder_sent_at" IS NULL
          AND ("reminder_claimed_at" IS NULL OR "reminder_claimed_at" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
          AND "starts_at" > CURRENT_TIMESTAMP
          AND "starts_at" - ("reminder_minutes" * INTERVAL '1 minute') <= CURRENT_TIMESTAMP
        ORDER BY "starts_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "community_events" e
      SET "reminder_claimed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
      FROM due
      WHERE e."id" = due."id"
      RETURNING e."id"::text AS id, e."guild_id" AS "guildId", e."channel_id" AS "channelId",
                e."title", e."starts_at" AS "startsAt", e."location"
    `;
    return rows;
  });
}

export async function markEventReminderSent(prisma: PrismaClient, eventId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "community_events"
    SET "reminder_sent_at" = CURRENT_TIMESTAMP, "reminder_claimed_at" = NULL,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${eventId}::uuid
  `;
}

export async function releaseEventReminderClaim(
  prisma: PrismaClient,
  eventId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "community_events"
    SET "reminder_claimed_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${eventId}::uuid AND "reminder_sent_at" IS NULL
  `;
}
