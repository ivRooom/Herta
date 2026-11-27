import type { PrismaClient } from '@herta/db';

export const VALORANT_SESSION_PREFIX = 'herta:valorant:pick:v1:';
export type ValorantSessionAction = 'join' | 'leave' | 'draw' | 'cancel' | 'reroll';
export type ValorantComponentAction =
  | ValorantSessionAction
  | 'vc'
  | 'manage'
  | 'troll-off'
  | 'add-select'
  | 'remove-select'
  | 'select-vc'
  | 'close'
  | `vc-commit-${string}`
  | `vc-choose-${string}`
  | `vc-stage-${string}`
  | `vc-bind-${string}`
  | `add-${string}`
  | `remove-${string}`;
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
      status:
        | 'missing'
        | 'closed'
        | 'full'
        | 'not_joined'
        | 'empty'
        | 'forbidden'
        | 'insufficient'
        | 'voice_changed'
        | 'invalid';
    };

export function parseValorantSessionAction(
  customId: string,
): { id: string; action: ValorantComponentAction } | null {
  if (!customId.startsWith(VALORANT_SESSION_PREFIX)) return null;
  const segments = customId.slice(VALORANT_SESSION_PREFIX.length).split(':');
  if (segments.length !== 2 || !/^[0-9a-f-]{36}$/i.test(segments[0] ?? '')) return null;
  const action = segments[1];
  if (
    ![
      'join',
      'leave',
      'draw',
      'cancel',
      'reroll',
      'vc',
      'manage',
      'troll-off',
      'add-select',
      'remove-select',
      'select-vc',
      'close',
    ].includes(action ?? '') &&
    !/^(vc-commit|vc-choose)-[a-f0-9]{12}$/.test(action ?? '') &&
    !/^vc-stage-[a-f0-9]{12}-[0-9a-z.]{1,20}$/.test(action ?? '') &&
    !/^(vc-bind|add|remove)-[0-9]{17,20}$/.test(action ?? '')
  )
    return null;
  return { id: segments[0]!, action: action as ValorantComponentAction };
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
    voiceChannelId?: string | null;
    vcAutoJoin?: boolean;
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
        if (row.optedOutUserIds.includes(input.userId)) {
          await tx.valorantPickSession.update({
            where: { id: row.id },
            data: { optedOutUserIds: row.optedOutUserIds.filter((id) => id !== input.userId) },
          });
        }
      } else if (input.action === 'leave') {
        if (!row.participants.some((entry) => entry.userId === input.userId))
          return { status: 'not_joined' };
        await tx.valorantPickParticipant.delete({
          where: { sessionId_userId: { sessionId: row.id, userId: input.userId } },
        });
        await tx.valorantPickSession.update({
          where: { id: row.id },
          data: { optedOutUserIds: [...new Set([...row.optedOutUserIds, input.userId])] },
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
 * Toggle the pressing participant's own troll-gacha opt-out (#1047).
 * Only participants can opt out, and only while the recruitment is OPEN;
 * the draw reads trollOffUserIds and passes them to the troll engine as
 * exclusions. Shares the session row lock with every other mutation.
 */
export async function toggleValorantSessionTrollOff(
  prisma: PrismaClient,
  input: { guildId: string; id: string; userId: string },
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
      if (row.status !== 'OPEN' || row.expiresAt <= new Date()) return { status: 'closed' };
      const isOff = row.trollOffUserIds.includes(input.userId);
      if (!isOff && !row.participants.some((entry) => entry.userId === input.userId))
        return { status: 'not_joined' };
      const trollOffUserIds = isOff
        ? row.trollOffUserIds.filter((id) => id !== input.userId)
        : [...row.trollOffUserIds, input.userId];
      const session = await tx.valorantPickSession.update({
        where: { id: row.id },
        data: { trollOffUserIds },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return { status: 'ok', session, changed: true };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

/**
 * Persist the troll assignments merged into a completed session's result
 * JSON (#1047). The external troll API call itself happens outside any
 * transaction; this only stores its outcome so later message rebuilds
 * (stale-button refresh, expiry sync) keep showing the same trolls.
 * Refuses to touch a session that is not COMPLETED.
 */
export async function attachValorantSessionTrollResult(
  prisma: PrismaClient,
  input: { guildId: string; id: string; result: unknown[] },
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
        input.id,
        input.guildId,
      );
      if (!locked.length) return false;
      const row = await tx.valorantPickSession.findFirst({
        where: { id: input.id, guildId: input.guildId },
        select: { status: true },
      });
      if (!row || row.status !== 'COMPLETED') return false;
      await tx.valorantPickSession.update({
        where: { id: input.id },
        data: { result: JSON.parse(JSON.stringify(input.result)) as object[] },
      });
      return true;
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

/**
 * Pin a VC exactly once. A session opened without the creator's VC requires
 * an explicit channel-selection confirmation. Never silently retarget it.
 */
export async function bindValorantVoiceChannel(
  prisma: PrismaClient,
  input: { guildId: string; id: string; userId: string; isAdmin: boolean; channelId: string },
): Promise<ValorantMutation> {
  if (!/^[0-9]{17,20}$/.test(input.channelId)) return { status: 'invalid' };
  return prisma.$transaction(
    async (tx) => {
      const locks = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
        input.id,
        input.guildId,
      );
      if (!locks.length) return { status: 'missing' };
      const row = await tx.valorantPickSession.findFirst({
        where: { id: input.id, guildId: input.guildId },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      if (!row) return { status: 'missing' };
      if (row.status !== 'OPEN' || row.expiresAt <= new Date()) return { status: 'closed' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      if (row.voiceChannelId && row.voiceChannelId !== input.channelId)
        return { status: 'voice_changed' };
      if (row.voiceChannelId === input.channelId)
        return { status: 'ok', session: row, changed: false };
      const session = await tx.valorantPickSession.update({
        where: { id: row.id },
        data: { voiceChannelId: input.channelId },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return { status: 'ok', session, changed: true };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

/**
 * Single-user or VC bulk updates share the same row lock as join/draw.
 * All Discord membership checks occur BEFORE calling this function.
 */
export async function manageValorantParticipants(
  prisma: PrismaClient,
  input: {
    guildId: string;
    id: string;
    userId: string;
    isAdmin: boolean;
    action: 'add' | 'remove' | 'bulk';
    targetIds: readonly string[];
    expectedVoiceChannelId?: string;
  },
): Promise<ValorantMutation> {
  const targets = [...new Set(input.targetIds)];
  if (
    targets.length === 0 ||
    targets.length > 100 ||
    targets.some((id) => !/^[0-9]{17,20}$/.test(id))
  )
    return { status: 'invalid' };
  return prisma.$transaction(
    async (tx) => {
      const locks = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "valorant_pick_sessions" WHERE "id" = $1 AND "guild_id" = $2 FOR UPDATE',
        input.id,
        input.guildId,
      );
      if (!locks.length) return { status: 'missing' };
      const row = await tx.valorantPickSession.findFirst({
        where: { id: input.id, guildId: input.guildId },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      if (!row) return { status: 'missing' };
      if (row.status !== 'OPEN' || row.expiresAt <= new Date()) return { status: 'closed' };
      if (row.creatorId !== input.userId && !input.isAdmin) return { status: 'forbidden' };
      if (input.action !== 'bulk' && targets.length !== 1) return { status: 'invalid' };
      if (
        input.action === 'bulk' &&
        (!row.voiceChannelId || row.voiceChannelId !== input.expectedVoiceChannelId)
      )
        return { status: 'voice_changed' };

      const existing = new Set(row.participants.map(({ userId }) => userId));
      if (input.action === 'remove' && !existing.has(targets[0]!)) return { status: 'not_joined' };
      const additions =
        input.action === 'remove'
          ? []
          : targets.filter(
              (id) =>
                !existing.has(id) && (input.action === 'add' || !row.optedOutUserIds.includes(id)),
            );
      if (existing.size + additions.length > row.maxParticipants) return { status: 'full' };
      if (input.action === 'remove') {
        await tx.valorantPickParticipant.delete({
          where: { sessionId_userId: { sessionId: row.id, userId: targets[0]! } },
        });
      } else {
        for (const userId of additions) {
          await tx.valorantPickParticipant.create({ data: { sessionId: row.id, userId } });
        }
        if (input.action === 'add' && row.optedOutUserIds.includes(targets[0]!)) {
          await tx.valorantPickSession.update({
            where: { id: row.id },
            data: { optedOutUserIds: row.optedOutUserIds.filter((id) => id !== targets[0]) },
          });
        }
      }
      const changed = input.action === 'remove' || additions.length > 0;
      if (!changed) return { status: 'ok', session: row, changed: false };
      const session = await tx.valorantPickSession.findUniqueOrThrow({
        where: { id: row.id },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return { status: 'ok', session, changed: true };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

export type ValorantAutoJoinResult =
  | { status: 'ok'; session: ValorantSessionSnapshot; changed: boolean; becameFull: boolean }
  | { status: 'missing' | 'closed' | 'not_auto' | 'opted_out' | 'full' };

/**
 * Candidate sessions for a live VC auto-join event (#1048). Only sessions
 * that explicitly opted in per-session are returned; a pinned voice channel
 * alone never enables auto-join (see migration 20261127133000). Expiry is
 * deliberately NOT decided here — the mutation re-checks it under the row
 * lock and performs the lazy EXPIRED transition, like every other mutation.
 */
export function findOpenValorantAutoJoinSessions(
  prisma: PrismaClient,
  guildId: string,
  voiceChannelId: string,
) {
  return prisma.valorantPickSession.findMany({
    where: { guildId, status: 'OPEN', vcAutoJoin: true, voiceChannelId },
    include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Register one member who just joined the pinned VC (#1048).
 *
 * This is intentionally NOT the manual join path: a manual join clears the
 * member's opt-out (an explicit act of will), while an automatic
 * registration must never clear it — an opted-out member is skipped and
 * stays opted out. Reaching capacity does not close the session: the row
 * stays OPEN so the creator can still draw, and every later join attempt
 * (auto, manual, bulk) is rejected by the capacity checks. Shares the
 * session row lock with every other mutation.
 */
export async function autoJoinValorantSession(
  prisma: PrismaClient,
  input: { guildId: string; id: string; userId: string; voiceChannelId: string },
): Promise<ValorantAutoJoinResult> {
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
      if (row.status !== 'OPEN') return { status: 'closed' };
      if (!row.vcAutoJoin || row.voiceChannelId !== input.voiceChannelId)
        return { status: 'not_auto' };
      if (row.optedOutUserIds.includes(input.userId)) return { status: 'opted_out' };
      if (row.participants.some((entry) => entry.userId === input.userId))
        return {
          status: 'ok',
          session: row,
          changed: false,
          becameFull: row.participants.length >= row.maxParticipants,
        };
      if (row.participants.length >= row.maxParticipants) return { status: 'full' };
      await tx.valorantPickParticipant.create({
        data: { sessionId: row.id, userId: input.userId },
      });
      const session = await tx.valorantPickSession.findUniqueOrThrow({
        where: { id: row.id },
        include: { participants: { orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] } },
      });
      return {
        status: 'ok',
        session,
        changed: true,
        becameFull: session.participants.length >= session.maxParticipants,
      };
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
