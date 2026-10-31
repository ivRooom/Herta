import type { PrismaClient } from '@herta/db';

export const VALORANT_SESSION_PREFIX = 'herta:valorant:pick:v1:';
export type ValorantSessionAction = 'join' | 'leave' | 'draw' | 'cancel' | 'reroll';
export interface ValorantCandidate {
  agentId: string;
  agentName: string;
  displayName: string;
}
export interface ValorantAssignment extends ValorantCandidate {
  userId: string;
}
export type ValorantSessionSnapshot = NonNullable<Awaited<ReturnType<typeof getValorantSession>>>;
export type ValorantMutation =
  | { status: 'ok'; session: ValorantSessionSnapshot; changed: boolean }
  | {
      status: 'missing' | 'closed' | 'full' | 'not_joined' | 'empty' | 'forbidden' | 'insufficient';
    };

export function parseValorantSessionAction(
  customId: string,
): { id: string; action: ValorantSessionAction } | null {
  if (!customId.startsWith(VALORANT_SESSION_PREFIX)) return null;
  const segments = customId.slice(VALORANT_SESSION_PREFIX.length).split(':');
  if (segments.length !== 2 || !/^[0-9a-f-]{36}$/i.test(segments[0] ?? '')) return null;
  const action = segments[1];
  if (
    action !== 'join' &&
    action !== 'leave' &&
    action !== 'draw' &&
    action !== 'cancel' &&
    action !== 'reroll'
  )
    return null;
  return { id: segments[0]!, action };
}

export function createValorantSession(
  prisma: PrismaClient,
  input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    mode: 'RANDOM' | 'TACTICAL';
    mapId: string | null;
    maxParticipants: number;
    expiresAt: Date;
    rulesVersion: string;
  },
) {
  return prisma.valorantPickSession.create({ data: input, include: { participants: true } });
}

/** A direct @mention draw is committed atomically, with its participants and full result. */
export function createDirectValorantSession(
  prisma: PrismaClient,
  input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    mode: 'RANDOM' | 'TACTICAL';
    mapId: string | null;
    expiresAt: Date;
    rulesVersion: string;
    participants: readonly string[];
    candidates: readonly ValorantCandidate[];
    assignments: readonly ValorantAssignment[];
  },
) {
  return prisma.valorantPickSession.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      creatorId: input.creatorId,
      mode: input.mode,
      mapId: input.mapId,
      maxParticipants: input.participants.length,
      expiresAt: input.expiresAt,
      rulesVersion: input.rulesVersion,
      status: 'COMPLETED',
      completedAt: new Date(),
      participants: { create: input.participants.map((userId) => ({ userId })) },
      candidates: input.candidates.map(({ agentId, agentName }) => ({ agentId, agentName })),
      result: input.assignments.map(({ userId, agentId, agentName, displayName }) => ({
        userId,
        agentId,
        agentName,
        displayName,
      })),
    },
    include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
  });
}

export function getValorantSession(prisma: PrismaClient, guildId: string, id: string) {
  return prisma.valorantPickSession.findFirst({
    where: { id, guildId },
    include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
  });
}

export async function setValorantSessionMessageId(
  prisma: PrismaClient,
  guildId: string,
  id: string,
  messageId: string,
): Promise<void> {
  await prisma.valorantPickSession.update({ where: { id, guildId }, data: { messageId } });
}

/**
 * The guild-scoped row lock serializes ALL mutations, including concurrent draws.
 * No Discord API calls run inside a DB transaction.
 */
export async function mutateValorantSession(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    userId: string;
    action: ValorantSessionAction;
    isAdmin: boolean;
    candidates?: readonly ValorantCandidate[];
    pick?: (
      participants: string[],
      candidates: readonly ValorantCandidate[],
      mode: string,
      mapId: string | null,
    ) => ValorantAssignment[] | null;
  },
): Promise<ValorantMutation> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
        input.id,
        input.guildId,
      );
      if (!locked.length) return { status: 'missing' };
      const row = await tx.valorantPickSession.findFirst({
        where: { id: input.id, guildId: input.guildId },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      if (!row) return { status: 'missing' };
      if (row.status === 'OPEN' && row.expiresAt <= new Date()) {
        await tx.valorantPickSession.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        return { status: 'closed' };
      }
      if (row.status !== 'OPEN' || input.action === 'reroll') return { status: 'closed' };
      if (
        (input.action === 'draw' || input.action === 'cancel') &&
        row.creatorId !== input.userId &&
        !input.isAdmin
      )
        return { status: 'forbidden' };

      if (input.action === 'join') {
        if (row.participants.some((entry) => entry.userId === input.userId))
          return { status: 'ok', session: row, changed: false };
        if (row.participants.length >= row.maxParticipants) return { status: 'full' };
        await tx.valorantPickParticipant.create({
          data: { sessionId: row.id, userId: input.userId },
        });
      } else if (input.action === 'leave') {
        if (!row.participants.some((entry) => entry.userId === input.userId))
          return { status: 'not_joined' };
        await tx.valorantPickParticipant.delete({
          where: { sessionId_userId: { sessionId: row.id, userId: input.userId } },
        });
      } else if (input.action === 'cancel') {
        await tx.valorantPickSession.update({
          where: { id: row.id },
          data: { status: 'CANCELLED' },
        });
      } else {
        if (!row.participants.length) return { status: 'empty' };
        const candidates = input.candidates ?? [];
        const assignments = input.pick?.(
          row.participants.map((entry) => entry.userId),
          candidates,
          row.mode,
          row.mapId,
        );
        if (
          !assignments ||
          assignments.length !== row.participants.length ||
          new Set(assignments.map((entry) => entry.agentId)).size !== assignments.length ||
          new Set(assignments.map((entry) => entry.userId)).size !== row.participants.length ||
          !assignments.every((entry) =>
            row.participants.some((member) => member.userId === entry.userId),
          )
        )
          return { status: 'insufficient' };
        await tx.valorantPickSession.update({
          where: { id: row.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            candidates: candidates.map((agent) => ({
              agentId: agent.agentId,
              agentName: agent.agentName,
            })),
            result: assignments.map(({ userId, agentId, agentName, displayName }) => ({
              userId,
              agentId,
              agentName,
              displayName,
            })),
          },
        });
      }
      const session = await tx.valorantPickSession.findUniqueOrThrow({
        where: { id: row.id },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return { status: 'ok', session, changed: true };
    },
    // The session row is locked with FOR UPDATE. ReadCommitted sees prior joins after waiting.
    { isolationLevel: 'ReadCommitted' },
  );
}

/**
 * An immutable completed draw is never overwritten. A reroll atomically transfers
 * the Discord message to a new completed session while keeping the previous row
 * (and any match result/stats) as history. The old button ID cannot be replayed.
 */
export async function rerollValorantSession(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    messageId: string;
    userId: string;
    isAdmin: boolean;
    candidates: readonly ValorantCandidate[];
    sessionDurationMinutes: number;
    rulesVersion: string;
    pick: (
      participants: string[],
      candidates: readonly ValorantCandidate[],
      mode: string,
      mapId: string | null,
    ) => ValorantAssignment[] | null;
  },
): Promise<ValorantMutation> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
        input.id,
        input.guildId,
      );
      if (!locked.length) return { status: 'missing' };
      const row = await tx.valorantPickSession.findFirst({
        where: { id: input.id, guildId: input.guildId },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      if (!row) return { status: 'missing' };
      if (row.status !== 'COMPLETED' || row.messageId !== input.messageId)
        return { status: 'closed' };
      if (row.expiresAt <= new Date()) return { status: 'closed' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      const participants = row.participants.map(({ userId }) => userId);
      if (participants.length === 0 || participants.length > 5) return { status: 'empty' };
      const assignments = input.pick(participants, input.candidates, row.mode, row.mapId);
      if (
        !assignments ||
        assignments.length !== participants.length ||
        new Set(assignments.map(({ agentId }) => agentId)).size !== participants.length ||
        new Set(assignments.map(({ userId }) => userId)).size !== participants.length ||
        !assignments.every(({ userId }) => participants.includes(userId))
      )
        return { status: 'insufficient' };

      // UNIQUE message_id is released before it is assigned to the next history row.
      await tx.valorantPickSession.update({
        where: { id: row.id },
        data: { messageId: null },
      });
      const session = await tx.valorantPickSession.create({
        data: {
          guildId: row.guildId,
          channelId: row.channelId,
          messageId: input.messageId,
          creatorId: row.creatorId,
          status: 'COMPLETED',
          mode: row.mode,
          mapId: row.mapId,
          maxParticipants: row.maxParticipants,
          expiresAt: new Date(Date.now() + input.sessionDurationMinutes * 60_000),
          completedAt: new Date(),
          rulesVersion: input.rulesVersion,
          candidates: input.candidates.map(({ agentId, agentName }) => ({ agentId, agentName })),
          result: assignments.map(({ userId, agentId, agentName, displayName }) => ({
            userId,
            agentId,
            agentName,
            displayName,
          })),
          participants: { create: participants.map((userId) => ({ userId })) },
        },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return { status: 'ok', session, changed: true };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}
