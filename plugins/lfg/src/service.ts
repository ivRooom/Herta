import {
  LfgValidationError,
  normalizeLfgPostInput,
  type LfgConfig,
  type LfgPostInput,
} from './config.js';

export type LfgPostStatus = 'open' | 'full' | 'closed' | 'cancelled' | 'expired';
export type LfgParticipantStatus = 'joined' | 'left';

export interface LfgPostRecord {
  id: string;
  guildId: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  game: string;
  title: string;
  description: string;
  maxPlayers: number;
  participantCount: number;
  startTime: Date | null;
  expiresAt: Date;
  status: LfgPostStatus;
  messageState: string;
  lastErrorName: string | null;
  closedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LfgParticipantRecord {
  lfgId: string;
  guildId: string;
  userId: string;
  status: LfgParticipantStatus;
  joinedAt: Date;
  leftAt: Date | null;
  updatedAt: Date;
}

interface LfgPostDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<LfgPostRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<LfgPostRecord | null>;
  create(args: Record<string, unknown>): Promise<LfgPostRecord>;
  update(args: Record<string, unknown>): Promise<LfgPostRecord>;
}

interface LfgParticipantDelegate {
  count(args: Record<string, unknown>): Promise<number>;
  findMany(args: Record<string, unknown>): Promise<LfgParticipantRecord[]>;
  findFirst(args: Record<string, unknown>): Promise<LfgParticipantRecord | null>;
  create(args: Record<string, unknown>): Promise<LfgParticipantRecord>;
  update(args: Record<string, unknown>): Promise<LfgParticipantRecord>;
}

interface AuditLogDelegate {
  create(args: Record<string, unknown>): Promise<unknown>;
}

interface GuildPluginDelegate {
  findUnique(args: Record<string, unknown>): Promise<{ enabled: boolean } | null>;
}

export interface LfgTransactionClient {
  lfgPost: LfgPostDelegate;
  lfgParticipant: LfgParticipantDelegate;
  auditLog: AuditLogDelegate;
  guildPlugin: GuildPluginDelegate;
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}

export interface LfgPrismaClient extends LfgTransactionClient {
  $transaction<T>(callback: (tx: LfgTransactionClient) => Promise<T>): Promise<T>;
}

export interface CreateLfgPostInput {
  guildId: string;
  creatorId: string;
  actorId: string;
  post: LfgPostInput;
  config: LfgConfig;
  now?: Date;
}

export type LfgJoinResult =
  | { state: 'joined'; post: LfgPostRecord }
  | { state: 'already_joined'; post: LfgPostRecord }
  | { state: 'full'; post: LfgPostRecord }
  | { state: 'closed'; post: LfgPostRecord }
  | { state: 'not_found' };

export type LfgLeaveResult =
  | { state: 'left'; post: LfgPostRecord }
  | { state: 'not_joined'; post: LfgPostRecord }
  | { state: 'creator_must_cancel'; post: LfgPostRecord }
  | { state: 'closed'; post: LfgPostRecord }
  | { state: 'not_found' };

export type LfgCloseResult =
  | { state: 'updated'; post: LfgPostRecord }
  | { state: 'forbidden'; post: LfgPostRecord }
  | { state: 'already_final'; post: LfgPostRecord }
  | { state: 'not_found' };

export async function createLfgPost(
  prisma: LfgPrismaClient,
  input: CreateLfgPostInput,
): Promise<LfgPostRecord> {
  const now = input.now ?? new Date();
  const normalized = normalizeLfgPostInput(input.post, input.config, now);

  return prisma.$transaction(async (tx) => {
    await lockGuild(tx, input.guildId);
    await lockChannel(tx, input.guildId, normalized.channelId);

    const activeStatuses: LfgPostStatus[] = ['open', 'full'];
    const [guildCount, channelCount] = await Promise.all([
      tx.lfgPost.count({
        where: {
          guildId: input.guildId,
          status: { in: activeStatuses },
          deletedAt: null,
        },
      }),
      tx.lfgPost.count({
        where: {
          guildId: input.guildId,
          channelId: normalized.channelId,
          status: { in: activeStatuses },
          deletedAt: null,
        },
      }),
    ]);
    if (guildCount >= input.config.maxOpenPostsPerGuild) {
      throw new LfgValidationError(
        `Guild内の募集中LFGは最大${input.config.maxOpenPostsPerGuild}件です`,
      );
    }
    if (channelCount >= input.config.maxOpenPostsPerChannel) {
      throw new LfgValidationError(
        `チャンネル内の募集中LFGは最大${input.config.maxOpenPostsPerChannel}件です`,
      );
    }

    if (input.config.creationCooldownSeconds > 0) {
      const cooldownSince = new Date(now.getTime() - input.config.creationCooldownSeconds * 1000);
      const recent = await tx.lfgPost.findFirst({
        where: {
          guildId: input.guildId,
          creatorId: input.creatorId,
          channelId: normalized.channelId,
          createdAt: { gte: cooldownSince },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        throw new LfgValidationError(
          `募集作成は${input.config.creationCooldownSeconds}秒ごとに行えます`,
        );
      }
    }

    const created = await tx.lfgPost.create({
      data: {
        guildId: input.guildId,
        creatorId: input.creatorId,
        channelId: normalized.channelId,
        game: normalized.game,
        title: normalized.title,
        description: normalized.description,
        maxPlayers: normalized.maxPlayers,
        participantCount: 1,
        startTime: normalized.startTime,
        expiresAt: normalized.expiresAt,
        status: normalized.maxPlayers === 1 ? 'full' : 'open',
        messageState: 'pending',
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await tx.lfgParticipant.create({
      data: {
        lfgId: created.id,
        guildId: input.guildId,
        userId: input.creatorId,
        status: 'joined',
        joinedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: 'lfg.create',
        targetType: 'lfg_post',
        targetId: created.id,
        changes: {
          channelId: normalized.channelId,
          game: normalized.game,
          maxPlayers: normalized.maxPlayers,
          startTime: normalized.startTime,
          expiresAt: normalized.expiresAt,
        },
      },
    });
    return created;
  });
}

export async function joinLfgPost(
  prisma: LfgPrismaClient,
  input: { guildId: string; postId: string; userId: string; actorId?: string; now?: Date },
): Promise<LfgJoinResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, input.guildId, input.postId);
    let post = await tx.lfgPost.findFirst({
      where: { id: input.postId, guildId: input.guildId, deletedAt: null },
    });
    if (!post) return { state: 'not_found' };
    post = await expireIfDue(tx, post, now);
    if (isFinalStatus(post.status)) return { state: 'closed', post };

    const existing = await tx.lfgParticipant.findFirst({
      where: { lfgId: post.id, guildId: input.guildId, userId: input.userId },
    });
    if (existing?.status === 'joined') return { state: 'already_joined', post };

    const joinedCount = await tx.lfgParticipant.count({
      where: { lfgId: post.id, guildId: input.guildId, status: 'joined' },
    });
    if (joinedCount >= post.maxPlayers) {
      const fullPost =
        post.status === 'full'
          ? post
          : await tx.lfgPost.update({
              where: { id: post.id },
              data: { status: 'full', participantCount: joinedCount, version: { increment: 1 } },
            });
      return { state: 'full', post: fullPost };
    }

    if (existing) {
      await tx.lfgParticipant.update({
        where: { lfgId_userId: { lfgId: post.id, userId: input.userId } },
        data: { status: 'joined', joinedAt: now, leftAt: null },
      });
    } else {
      await tx.lfgParticipant.create({
        data: {
          lfgId: post.id,
          guildId: input.guildId,
          userId: input.userId,
          status: 'joined',
          joinedAt: now,
        },
      });
    }

    const nextCount = joinedCount + 1;
    const updated = await tx.lfgPost.update({
      where: { id: post.id },
      data: {
        participantCount: nextCount,
        status: nextCount >= post.maxPlayers ? 'full' : 'open',
        updatedBy: input.actorId ?? input.userId,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId ?? input.userId,
        event: 'lfg.join',
        targetType: 'lfg_post',
        targetId: post.id,
        changes: { participantCount: nextCount },
      },
    });
    return { state: 'joined', post: updated };
  });
}

export async function leaveLfgPost(
  prisma: LfgPrismaClient,
  input: { guildId: string; postId: string; userId: string; actorId?: string; now?: Date },
): Promise<LfgLeaveResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, input.guildId, input.postId);
    let post = await tx.lfgPost.findFirst({
      where: { id: input.postId, guildId: input.guildId, deletedAt: null },
    });
    if (!post) return { state: 'not_found' };
    post = await expireIfDue(tx, post, now);
    if (isFinalStatus(post.status)) return { state: 'closed', post };
    if (post.creatorId === input.userId) return { state: 'creator_must_cancel', post };

    const existing = await tx.lfgParticipant.findFirst({
      where: {
        lfgId: post.id,
        guildId: input.guildId,
        userId: input.userId,
        status: 'joined',
      },
    });
    if (!existing) return { state: 'not_joined', post };

    await tx.lfgParticipant.update({
      where: { lfgId_userId: { lfgId: post.id, userId: input.userId } },
      data: { status: 'left', leftAt: now },
    });
    const nextCount = Math.max(1, post.participantCount - 1);
    const updated = await tx.lfgPost.update({
      where: { id: post.id },
      data: {
        participantCount: nextCount,
        status: 'open',
        updatedBy: input.actorId ?? input.userId,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId ?? input.userId,
        event: 'lfg.leave',
        targetType: 'lfg_post',
        targetId: post.id,
        changes: { participantCount: nextCount },
      },
    });
    return { state: 'left', post: updated };
  });
}

export async function closeLfgPost(
  prisma: LfgPrismaClient,
  input: {
    guildId: string;
    postId: string;
    actorId: string;
    mode: 'closed' | 'cancelled';
    force?: boolean;
    now?: Date;
  },
): Promise<LfgCloseResult> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, input.guildId, input.postId);
    const post = await tx.lfgPost.findFirst({
      where: { id: input.postId, guildId: input.guildId, deletedAt: null },
    });
    if (!post) return { state: 'not_found' };
    if (isFinalStatus(post.status)) return { state: 'already_final', post };
    if (!input.force && post.creatorId !== input.actorId) return { state: 'forbidden', post };

    const updated = await tx.lfgPost.update({
      where: { id: post.id },
      data: {
        status: input.mode,
        closedAt: now,
        updatedBy: input.actorId,
        version: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: input.actorId,
        event: input.mode === 'closed' ? 'lfg.close' : 'lfg.cancel',
        targetType: 'lfg_post',
        targetId: post.id,
        changes: { status: input.mode },
      },
    });
    return { state: 'updated', post: updated };
  });
}

export async function getLfgPost(
  prisma: LfgPrismaClient,
  guildId: string,
  postId: string,
): Promise<LfgPostRecord | null> {
  return prisma.lfgPost.findFirst({
    where: { id: postId, guildId, deletedAt: null },
  });
}

export async function listLfgPosts(
  prisma: LfgPrismaClient,
  input: { guildId: string; status?: LfgPostStatus; take?: number },
): Promise<LfgPostRecord[]> {
  return prisma.lfgPost.findMany({
    where: {
      guildId: input.guildId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, input.take ?? 20)),
  });
}

export async function listLfgParticipants(
  prisma: LfgPrismaClient,
  guildId: string,
  postId: string,
): Promise<LfgParticipantRecord[]> {
  return prisma.lfgParticipant.findMany({
    where: { lfgId: postId, guildId, status: 'joined' },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function updateLfgMessageReference(
  prisma: LfgPrismaClient,
  input: { guildId: string; postId: string; messageId: string; actorId: string },
): Promise<LfgPostRecord | null> {
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, input.guildId, input.postId);
    const post = await tx.lfgPost.findFirst({
      where: { id: input.postId, guildId: input.guildId, deletedAt: null },
    });
    if (!post) return null;
    return tx.lfgPost.update({
      where: { id: post.id },
      data: {
        messageId: input.messageId,
        messageState: 'active',
        lastErrorName: null,
        updatedBy: input.actorId,
      },
    });
  });
}

export async function markLfgMessageMissing(
  prisma: LfgPrismaClient,
  input: { guildId: string; messageId: string; errorName?: string },
): Promise<LfgPostRecord | null> {
  const post = await prisma.lfgPost.findFirst({
    where: {
      guildId: input.guildId,
      messageId: input.messageId,
      status: { in: ['open', 'full'] },
      deletedAt: null,
    },
  });
  if (!post) return null;
  return prisma.lfgPost.update({
    where: { id: post.id },
    data: {
      messageId: null,
      messageState: 'missing',
      lastErrorName: input.errorName ?? 'LfgMessageDeleted',
      version: { increment: 1 },
    },
  });
}

export async function listDueLfgPosts(
  prisma: LfgPrismaClient,
  now: Date,
  take = 100,
): Promise<LfgPostRecord[]> {
  return prisma.lfgPost.findMany({
    where: {
      status: { in: ['open', 'full'] },
      expiresAt: { lte: now },
      deletedAt: null,
    },
    orderBy: { expiresAt: 'asc' },
    take,
  });
}

export async function expireLfgPost(
  prisma: LfgPrismaClient,
  input: { guildId: string; postId: string; now?: Date },
): Promise<LfgPostRecord | null> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPost(tx, input.guildId, input.postId);
    const post = await tx.lfgPost.findFirst({
      where: { id: input.postId, guildId: input.guildId, deletedAt: null },
    });
    if (!post || isFinalStatus(post.status) || post.expiresAt.getTime() > now.getTime()) {
      return post;
    }
    const updated = await tx.lfgPost.update({
      where: { id: post.id },
      data: { status: 'expired', closedAt: now, version: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        actorId: 'system',
        actorType: 'system',
        event: 'lfg.expire',
        targetType: 'lfg_post',
        targetId: post.id,
        changes: { status: 'expired' },
      },
    });
    return updated;
  });
}

export async function isLfgPluginEnabled(
  prisma: LfgPrismaClient,
  guildId: string,
): Promise<boolean> {
  const plugin = await prisma.guildPlugin.findUnique({
    where: { guildId_pluginId: { guildId, pluginId: 'lfg' } },
    select: { enabled: true },
  });
  return plugin?.enabled === true;
}

async function expireIfDue(
  tx: LfgTransactionClient,
  post: LfgPostRecord,
  now: Date,
): Promise<LfgPostRecord> {
  if (post.expiresAt.getTime() > now.getTime() || isFinalStatus(post.status)) return post;
  return tx.lfgPost.update({
    where: { id: post.id },
    data: { status: 'expired', closedAt: now, version: { increment: 1 } },
  });
}

function isFinalStatus(status: LfgPostStatus): boolean {
  return status === 'closed' || status === 'cancelled' || status === 'expired';
}

async function lockGuild(tx: LfgTransactionClient, guildId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `lfg:guild:${guildId}`,
  );
}

async function lockChannel(
  tx: LfgTransactionClient,
  guildId: string,
  channelId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `lfg:channel:${guildId}:${channelId}`,
  );
}

async function lockPost(tx: LfgTransactionClient, guildId: string, postId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    `lfg:post:${guildId}:${postId}`,
  );
}
