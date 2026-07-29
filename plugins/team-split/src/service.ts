import { randomUUID } from 'node:crypto';
import {
  TeamSplitValidationError,
  normalizeParticipantScore,
  normalizeTeamSplitSessionInput,
  type TeamSplitConfig,
  type TeamSplitMode,
  type TeamSplitSessionInput,
} from './config.js';
import { deriveTeamSplitSeedHash, splitTeamMembers, type TeamSplitTeam } from './split.js';

export type TeamSplitSessionStatus = 'open' | 'split' | 'closed' | 'expired';
export type TeamSplitParticipantStatus = 'joined' | 'left';

export interface TeamSplitSessionRecord {
  id: string;
  guildId: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  teamCount: number;
  mode: TeamSplitMode;
  maxParticipants: number;
  participantCount: number;
  participants: string[];
  teams: unknown;
  seedHash: string;
  generation: number;
  status: TeamSplitSessionStatus;
  expiresAt: Date;
  splitAt: Date | null;
  closedAt: Date | null;
  messageState: string;
  lastErrorName: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamSplitParticipantRecord {
  sessionId: string;
  guildId: string;
  userId: string;
  score: number;
  status: TeamSplitParticipantStatus;
  joinedAt: Date;
  leftAt: Date | null;
  updatedAt: Date;
}

interface TeamSplitSessionDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<TeamSplitSessionRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<TeamSplitSessionRecord | null>;
  create(args: Record<string, unknown>): Promise<TeamSplitSessionRecord>;
  update(args: Record<string, unknown>): Promise<TeamSplitSessionRecord>;
}

interface TeamSplitParticipantDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<TeamSplitParticipantRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<TeamSplitParticipantRecord | null>;
  create(args: Record<string, unknown>): Promise<TeamSplitParticipantRecord>;
  update(args: Record<string, unknown>): Promise<TeamSplitParticipantRecord>;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

interface GuildPluginDelegate {
  findUnique(args: Record<string, unknown>): Promise<{ enabled: boolean; config?: unknown } | null>;
}

export interface TeamSplitTransactionClient {
  teamSplitSession: TeamSplitSessionDelegate;
  teamSplitParticipant: TeamSplitParticipantDelegate;
  auditLog: AuditLogDelegate;
  guildPlugin: GuildPluginDelegate;
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

export interface TeamSplitPrismaClient extends TeamSplitTransactionClient {
  $transaction<T>(callback: (tx: TeamSplitTransactionClient) => Promise<T>): Promise<T>;
}

export interface CreateTeamSplitSessionInput {
  guildId: string;
  creatorId: string;
  actorId: string;
  session: TeamSplitSessionInput;
  config: TeamSplitConfig;
  secret: string;
  creatorScore?: number | null;
  now?: Date;
}

export type TeamSplitJoinResult =
  | { state: 'joined' | 'updated'; session: TeamSplitSessionRecord }
  | { state: 'already_joined'; session: TeamSplitSessionRecord }
  | { state: 'full'; session: TeamSplitSessionRecord }
  | { state: 'locked'; session: TeamSplitSessionRecord }
  | { state: 'not_found' };

export type TeamSplitLeaveResult =
  | { state: 'left'; session: TeamSplitSessionRecord }
  | { state: 'not_joined'; session: TeamSplitSessionRecord }
  | { state: 'creator_must_close'; session: TeamSplitSessionRecord }
  | { state: 'locked'; session: TeamSplitSessionRecord }
  | { state: 'not_found' };

export type TeamSplitActionResult =
  | { state: 'updated'; session: TeamSplitSessionRecord; teams?: TeamSplitTeam[] }
  | { state: 'forbidden'; session: TeamSplitSessionRecord }
  | { state: 'invalid_state'; session: TeamSplitSessionRecord }
  | { state: 'not_enough_participants'; session: TeamSplitSessionRecord }
  | { state: 'not_found' };

export async function createTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: CreateTeamSplitSessionInput,
): Promise<TeamSplitSessionRecord> {
  const now = input.now ?? new Date();
  const normalized = normalizeTeamSplitSessionInput(input.session, input.config, now);
  const creatorScore = normalizeParticipantScore(input.creatorScore);
  const sessionId = randomUUID();
  const seedHash = deriveTeamSplitSeedHash(
    input.secret,
    input.guildId,
    sessionId,
    normalized.requestedSeed,
  );

  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    await lockChannel(tx, input.guildId, normalized.channelId);

    const activeStatuses: TeamSplitSessionStatus[] = ['open', 'split'];
    const [guildCount, channelCount] = await Promise.all([
      tx.teamSplitSession.count({
        where: { guildId: input.guildId, status: { in: activeStatuses }, deletedAt: null },
      }),
      tx.teamSplitSession.count({
        where: {
          guildId: input.guildId,
          channelId: normalized.channelId,
          status: { in: activeStatuses },
          deletedAt: null,
        },
      }),
    ]);
    if (guildCount >= input.config.maxOpenSessionsPerGuild) {
      throw new TeamSplitValidationError(
        `Guild内の進行中セッションは最大${input.config.maxOpenSessionsPerGuild}件です`,
      );
    }
    if (channelCount >= input.config.maxOpenSessionsPerChannel) {
      throw new TeamSplitValidationError(
        `チャンネル内の進行中セッションは最大${input.config.maxOpenSessionsPerChannel}件です`,
      );
    }

    if (input.config.creationCooldownSeconds > 0) {
      const cooldownSince = new Date(now.getTime() - input.config.creationCooldownSeconds * 1000);
      const recent = await tx.teamSplitSession.findFirst({
        where: {
          guildId: input.guildId,
          creatorId: input.creatorId,
          channelId: normalized.channelId,
          createdAt: { gte: cooldownSince },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        throw new TeamSplitValidationError(
          `セッション作成は${input.config.creationCooldownSeconds}秒ごとに行えます`,
        );
      }
    }

    const created = await tx.teamSplitSession.create({
      data: {
        id: sessionId,
        guildId: input.guildId,
        creatorId: input.creatorId,
        channelId: normalized.channelId,
        title: normalized.title,
        teamCount: normalized.teamCount,
        mode: normalized.mode,
        maxParticipants: normalized.maxParticipants,
        participantCount: 1,
        participants: [input.creatorId],
        teams: null,
        seedHash,
        generation: 0,
        status: 'open',
        expiresAt: normalized.expiresAt,
        messageState: 'pending',
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await tx.teamSplitParticipant.create({
      data: {
        sessionId: created.id,
        guildId: input.guildId,
        userId: input.creatorId,
        score: creatorScore,
        status: 'joined',
        joinedAt: now,
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: input.actorId,
      event: 'team_split.create',
      sessionId: created.id,
      changes: {
        channelId: normalized.channelId,
        mode: normalized.mode,
        teamCount: normalized.teamCount,
        maxParticipants: normalized.maxParticipants,
        expiresAt: normalized.expiresAt,
      },
    });
    return created;
  });
}

export async function joinTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    userId: string;
    score?: number | null;
    actorId?: string;
    now?: Date;
  },
): Promise<TeamSplitJoinResult> {
  const now = input.now ?? new Date();
  const score = normalizeParticipantScore(input.score);
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    let session = await findSession(tx, input.guildId, input.sessionId);
    if (!session) return { state: 'not_found' };
    session = await expireIfDue(tx, session, now);
    if (session.status !== 'open') return { state: 'locked', session };

    const existing = await tx.teamSplitParticipant.findFirst({
      where: { sessionId: session.id, guildId: input.guildId, userId: input.userId },
    });
    if (existing?.status === 'joined' && existing.score === score) {
      return { state: 'already_joined', session };
    }

    const joinedCount = await tx.teamSplitParticipant.count({
      where: { sessionId: session.id, guildId: input.guildId, status: 'joined' },
    });
    if (!existing || existing.status !== 'joined') {
      if (joinedCount >= session.maxParticipants) return { state: 'full', session };
      if (existing) {
        await tx.teamSplitParticipant.update({
          where: { sessionId_userId: { sessionId: session.id, userId: input.userId } },
          data: { score, status: 'joined', joinedAt: now, leftAt: null },
        });
      } else {
        await tx.teamSplitParticipant.create({
          data: {
            sessionId: session.id,
            guildId: input.guildId,
            userId: input.userId,
            score,
            status: 'joined',
            joinedAt: now,
          },
        });
      }
    } else {
      await tx.teamSplitParticipant.update({
        where: { sessionId_userId: { sessionId: session.id, userId: input.userId } },
        data: { score },
      });
    }

    const nextCount = existing?.status === 'joined' ? joinedCount : joinedCount + 1;
    const updated = await tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        participantCount: nextCount,
        participants: await listJoinedUserIds(tx, input.guildId, session.id),
        updatedBy: input.actorId ?? input.userId,
        messageState: 'pending',
        lastErrorName: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: input.actorId ?? input.userId,
      event: existing?.status === 'joined' ? 'team_split.score_update' : 'team_split.join',
      sessionId: session.id,
      changes: { participantCount: nextCount, targetUserId: input.userId },
    });
    return { state: existing?.status === 'joined' ? 'updated' : 'joined', session: updated };
  });
}

export async function leaveTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; userId: string; actorId?: string; now?: Date },
): Promise<TeamSplitLeaveResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    let session = await findSession(tx, input.guildId, input.sessionId);
    if (!session) return { state: 'not_found' };
    session = await expireIfDue(tx, session, now);
    if (session.status !== 'open') return { state: 'locked', session };
    if (session.creatorId === input.userId) return { state: 'creator_must_close', session };

    const existing = await tx.teamSplitParticipant.findFirst({
      where: {
        sessionId: session.id,
        guildId: input.guildId,
        userId: input.userId,
        status: 'joined',
      },
    });
    if (!existing) return { state: 'not_joined', session };

    await tx.teamSplitParticipant.update({
      where: { sessionId_userId: { sessionId: session.id, userId: input.userId } },
      data: { status: 'left', leftAt: now },
    });
    const nextCount = Math.max(1, session.participantCount - 1);
    const updated = await tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        participantCount: nextCount,
        participants: await listJoinedUserIds(tx, input.guildId, session.id),
        updatedBy: input.actorId ?? input.userId,
        messageState: 'pending',
        lastErrorName: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: input.actorId ?? input.userId,
      event: 'team_split.leave',
      sessionId: session.id,
      changes: { participantCount: nextCount, targetUserId: input.userId },
    });
    return { state: 'left', session: updated };
  });
}

export async function removeTeamSplitParticipant(
  prisma: TeamSplitPrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    targetUserId: string;
    actorId: string;
    force?: boolean;
    now?: Date;
  },
): Promise<TeamSplitLeaveResult | { state: 'forbidden'; session: TeamSplitSessionRecord }> {
  const session = await getTeamSplitSession(prisma, input.guildId, input.sessionId);
  if (!session) return { state: 'not_found' };
  if (!input.force && session.creatorId !== input.actorId) return { state: 'forbidden', session };
  return leaveTeamSplitSession(prisma, {
    guildId: input.guildId,
    sessionId: input.sessionId,
    userId: input.targetUserId,
    actorId: input.actorId,
    now: input.now,
  });
}

export async function splitTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; actorId: string; force?: boolean; now?: Date },
): Promise<TeamSplitActionResult> {
  return calculateAndStoreTeams(prisma, { ...input, reroll: false });
}

export async function rerollTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; actorId: string; force?: boolean; now?: Date },
): Promise<TeamSplitActionResult> {
  return calculateAndStoreTeams(prisma, { ...input, reroll: true });
}

export async function closeTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; actorId: string; force?: boolean; now?: Date },
): Promise<TeamSplitActionResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    const session = await findSession(tx, input.guildId, input.sessionId);
    if (!session) return { state: 'not_found' };
    if (session.status === 'closed' || session.status === 'expired') {
      return { state: 'invalid_state', session };
    }
    if (!input.force && session.creatorId !== input.actorId) {
      return { state: 'forbidden', session };
    }
    const updated = await tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        status: 'closed',
        closedAt: now,
        updatedBy: input.actorId,
        messageState: 'pending',
        lastErrorName: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: input.actorId,
      event: 'team_split.close',
      sessionId: session.id,
      changes: { status: 'closed' },
    });
    return { state: 'updated', session: updated };
  });
}

export async function getTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  guildId: string,
  sessionId: string,
): Promise<TeamSplitSessionRecord | null> {
  return prisma.teamSplitSession.findFirst({
    where: { id: sessionId, guildId, deletedAt: null },
  });
}

export async function listTeamSplitSessions(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; status?: TeamSplitSessionStatus; take?: number },
): Promise<TeamSplitSessionRecord[]> {
  return prisma.teamSplitSession.findMany({
    where: {
      guildId: input.guildId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, input.take ?? 20)),
  });
}

export async function listTeamSplitParticipants(
  prisma: TeamSplitPrismaClient,
  guildId: string,
  sessionId: string,
): Promise<TeamSplitParticipantRecord[]> {
  return prisma.teamSplitParticipant.findMany({
    where: { sessionId, guildId, status: 'joined' },
    orderBy: [{ score: 'desc' }, { joinedAt: 'asc' }],
  });
}

export async function updateTeamSplitMessageReference(
  prisma: TeamSplitPrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    messageId: string;
    actorId: string;
    expectedVersion: number;
  },
): Promise<TeamSplitSessionRecord | null> {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    const session = await findSession(tx, input.guildId, input.sessionId);
    if (!session || session.version !== input.expectedVersion) return session;
    return tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        messageId: input.messageId,
        messageState: 'active',
        lastErrorName: null,
        updatedBy: input.actorId,
      },
    });
  });
}

export async function markTeamSplitMessageSynchronized(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; expectedVersion: number },
): Promise<TeamSplitSessionRecord | null> {
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    const session = await findSession(tx, input.guildId, input.sessionId);
    if (!session || session.version !== input.expectedVersion) return session;
    return tx.teamSplitSession.update({
      where: { id: session.id },
      data: { messageState: 'active', lastErrorName: null },
    });
  });
}

export async function markTeamSplitMessageMissing(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; messageId: string; errorName?: string },
): Promise<TeamSplitSessionRecord | null> {
  const session = await prisma.teamSplitSession.findFirst({
    where: {
      guildId: input.guildId,
      messageId: input.messageId,
      status: { in: ['open', 'split'] },
      deletedAt: null,
    },
  });
  if (!session) return null;
  return prisma.teamSplitSession.update({
    where: { id: session.id },
    data: {
      messageId: null,
      messageState: 'missing',
      lastErrorName: input.errorName ?? 'TeamSplitMessageDeleted',
      version: { increment: 1 },
    },
  });
}

export async function listDueTeamSplitSessions(
  prisma: TeamSplitPrismaClient,
  now: Date,
  take = 100,
): Promise<TeamSplitSessionRecord[]> {
  return prisma.teamSplitSession.findMany({
    where: {
      status: { in: ['open', 'split'] },
      expiresAt: { lte: now },
      deletedAt: null,
    },
    orderBy: { expiresAt: 'asc' },
    take,
  });
}

export async function expireTeamSplitSession(
  prisma: TeamSplitPrismaClient,
  input: { guildId: string; sessionId: string; now?: Date },
): Promise<TeamSplitSessionRecord | null> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    const session = await findSession(tx, input.guildId, input.sessionId);
    if (!session || isFinalStatus(session.status) || session.expiresAt.getTime() > now.getTime()) {
      return session;
    }
    const updated = await tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        status: 'expired',
        closedAt: now,
        messageState: 'pending',
        lastErrorName: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: 'system',
      actorType: 'system',
      event: 'team_split.expire',
      sessionId: session.id,
      changes: { status: 'expired' },
    });
    return updated;
  });
}

export async function isTeamSplitPluginEnabled(
  prisma: TeamSplitPrismaClient,
  guildId: string,
): Promise<boolean> {
  const plugin = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId: 'team-split' } },
    select: { enabled: true },
  });
  return plugin?.enabled === true;
}

async function calculateAndStoreTeams(
  prisma: TeamSplitPrismaClient,
  input: {
    guildId: string;
    sessionId: string;
    actorId: string;
    force?: boolean;
    reroll: boolean;
    now?: Date;
  },
): Promise<TeamSplitActionResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockSession(tx, input.guildId, input.sessionId);
    let session = await findSession(tx, input.guildId, input.sessionId);
    if (!session) return { state: 'not_found' };
    session = await expireIfDue(tx, session, now);
    if (!input.force && session.creatorId !== input.actorId) {
      return { state: 'forbidden', session };
    }
    if (input.reroll ? session.status !== 'split' : session.status !== 'open') {
      return { state: 'invalid_state', session };
    }

    const participants = await tx.teamSplitParticipant.findMany({
      where: { sessionId: session.id, guildId: input.guildId, status: 'joined' },
      orderBy: [{ joinedAt: 'asc' }],
    });
    if (participants.length < session.teamCount) {
      return { state: 'not_enough_participants', session };
    }

    const generation = input.reroll ? session.generation + 1 : session.generation;
    const teams = splitTeamMembers(
      participants.map((participant) => ({ userId: participant.userId, score: participant.score })),
      session.teamCount,
      session.mode,
      session.seedHash,
      generation,
    );
    const updated = await tx.teamSplitSession.update({
      where: { id: session.id },
      data: {
        teams,
        status: 'split',
        generation,
        splitAt: now,
        updatedBy: input.actorId,
        messageState: 'pending',
        lastErrorName: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorId: input.actorId,
      event: input.reroll ? 'team_split.reroll' : 'team_split.split',
      sessionId: session.id,
      changes: {
        generation,
        teamCount: session.teamCount,
        participantCount: participants.length,
        mode: session.mode,
      },
    });
    return { state: 'updated', session: updated, teams };
  });
}

async function findSession(
  tx: TeamSplitTransactionClient,
  guildId: string,
  sessionId: string,
): Promise<TeamSplitSessionRecord | null> {
  return tx.teamSplitSession.findFirst({
    where: { id: sessionId, guildId, deletedAt: null },
  });
}

async function listJoinedUserIds(
  tx: TeamSplitTransactionClient,
  guildId: string,
  sessionId: string,
): Promise<string[]> {
  const participants = await tx.teamSplitParticipant.findMany({
    where: { sessionId, guildId, status: 'joined' },
    orderBy: { joinedAt: 'asc' },
  });
  return participants.map((participant) => participant.userId);
}

async function expireIfDue(
  tx: TeamSplitTransactionClient,
  session: TeamSplitSessionRecord,
  now: Date,
): Promise<TeamSplitSessionRecord> {
  if (session.expiresAt.getTime() > now.getTime() || isFinalStatus(session.status)) return session;
  return tx.teamSplitSession.update({
    where: { id: session.id },
    data: {
      status: 'expired',
      closedAt: now,
      messageState: 'pending',
      lastErrorName: null,
      version: { increment: 1 },
    },
  });
}

function isFinalStatus(status: TeamSplitSessionStatus): boolean {
  return status === 'closed' || status === 'expired';
}

async function writeAudit(
  tx: TeamSplitTransactionClient,
  input: {
    guildId: string;
    actorId: string;
    actorType?: string;
    event: string;
    sessionId: string;
    changes: Record<string, unknown>;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      guildId: input.guildId,
      actorId: input.actorId,
      actorType: input.actorType ?? 'user',
      event: input.event,
      targetType: 'team_split_session',
      targetId: input.sessionId,
      changes: input.changes,
    },
  });
}

async function lockGuild(tx: TeamSplitTransactionClient, guildId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `team-split:guild:${guildId}`,
  );
}

async function lockChannel(
  tx: TeamSplitTransactionClient,
  guildId: string,
  channelId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `team-split:channel:${guildId}:${channelId}`,
  );
}

async function lockSession(
  tx: TeamSplitTransactionClient,
  guildId: string,
  sessionId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `team-split:session:${guildId}:${sessionId}`,
  );
}
