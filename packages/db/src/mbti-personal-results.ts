import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  recordMbtiQuizCompletionInTransaction,
  type MbtiQuizCompletionInput,
} from './mbti-stats-analytics.js';

type Store = Pick<Prisma.TransactionClient, 'mbtiPersonalResult' | 'mbtiResultAccess'>;
export const MBTI_RESULT_ACCESS_MS = 30 * 60 * 1000;
export interface MbtiPersonalResultInput {
  completionKey: string;
  guildId: string;
  discordUserId: string;
  resultType: string;
  resultIdentity: string;
  scores: Record<string, number>;
  percentages: Record<string, number>;
  questionCount: number;
  scoringVersion: string;
  source: 'discord' | 'web';
  completedAt: Date;
}

/** Immutable history; completion identity prevents retry duplicates. Latest is a projection. */
export async function saveMbtiPersonalResult(store: Store, input: MbtiPersonalResultInput) {
  return store.mbtiPersonalResult.createMany({
    data: [{ ...input, id: randomUUID() }],
    skipDuplicates: true,
  });
}

export async function saveMbtiCompletedResult(
  prisma: PrismaClient,
  result: MbtiPersonalResultInput,
  stats: MbtiQuizCompletionInput,
) {
  return prisma.$transaction(async (tx) => {
    const saved = await saveMbtiPersonalResult(tx, result);
    if (saved.count) await recordMbtiQuizCompletionInTransaction(tx, stats);
    return saved;
  });
}

export async function issueMbtiResultAccess(store: Store, guildId: string, discordUserId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MBTI_RESULT_ACCESS_MS);
  const data = { tokenHash: hashToken(token), expiresAt };
  await store.mbtiResultAccess.upsert({
    where: { guildId_discordUserId: { guildId, discordUserId } },
    create: { guildId, discordUserId, ...data },
    update: data,
  });
  return { token, expiresAt };
}

export async function resolveMbtiResultAccess(store: Store, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const access = await store.mbtiResultAccess.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  return access && access.expiresAt.getTime() > Date.now()
    ? { guildId: access.guildId, discordUserId: access.discordUserId }
    : null;
}

/** Strict subject scope, stable keyset pagination; latest never depends on delivery order. */
export async function getMbtiPersonalHistory(
  store: Store,
  subject: { guildId: string; discordUserId: string },
  beforeId?: string,
) {
  const before = beforeId
    ? await store.mbtiPersonalResult.findFirst({ where: { ...subject, id: beforeId } })
    : null;
  if (beforeId && !before) return [];
  return store.mbtiPersonalResult.findMany({
    where: {
      ...subject,
      ...(before
        ? {
            OR: [
              { completedAt: { lt: before.completedAt } },
              { completedAt: before.completedAt, id: { lt: before.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    take: 21,
  });
}

export async function getMbtiPersonalResult(
  store: Store,
  subject: { guildId: string; discordUserId: string },
  id?: string,
) {
  return store.mbtiPersonalResult.findFirst({
    where: { ...subject, ...(id ? { id } : {}) },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
  });
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function pruneMbtiResultAccess(prisma: PrismaClient) {
  return prisma.mbtiResultAccess.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
