import type { Prisma, PrismaClient } from '@prisma/client';
import { syncAchievementUnlocksInTransaction } from './achievement-unlocks.js';
import { saveMbtiPersonalResult, type MbtiPersonalResultInput } from './mbti-personal-results.js';
import {
  recordMbtiQuizCompletionInTransaction,
  type MbtiQuizCompletionInput,
} from './mbti-stats-analytics.js';

/** @herta/shared/mbti-coreのMbtiQuestion/MbtiScores/MbtiSessionAnswerと同じ形。 */
export interface MbtiWebQuizQuestion {
  id: number;
  axis: string;
  prompt: string;
  direction?: 1 | -1;
  facet?: string;
}

export interface MbtiWebQuizAnswer {
  questionIndex: number;
  axis: string;
  answer: string;
}

export interface MbtiWebQuizSessionRecord {
  id: string;
  guildId: string;
  discordUserId: string;
  status: string;
  questionOrder: MbtiWebQuizQuestion[];
  answers: MbtiWebQuizAnswer[];
  scores: Record<string, number>;
  resultType: string | null;
  resultIdentity: string | null;
  completedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

// 回答は毎回DBへ保存。新規リンクは24時間以内ならブラウザを閉じても再開できる。
const DEFAULT_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;

export async function createMbtiWebQuizSession(
  prisma: Pick<PrismaClient, 'mbtiWebQuizSession'>,
  input: {
    guildId: string;
    discordUserId: string;
    questions: readonly MbtiWebQuizQuestion[];
    expiresInMs?: number;
  },
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? DEFAULT_EXPIRES_IN_MS));
  const session = await prisma.mbtiWebQuizSession.create({
    data: {
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      questionOrder: input.questions as unknown as object,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  return session;
}

/** Serialize member-link retries so every concurrent request resumes one pending quiz. */
export async function getOrCreateMbtiWebQuizSession(
  prisma: PrismaClient,
  input: {
    guildId: string;
    discordUserId: string;
    questions: readonly MbtiWebQuizQuestion[];
  },
): Promise<{ id: string; expiresAt: Date; resumed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `mbti-member-link:${input.guildId}:${input.discordUserId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const pending = await tx.mbtiWebQuizSession.findFirst({
      where: {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true },
    });
    if (pending) return { ...pending, resumed: true };
    return { ...(await createMbtiWebQuizSession(tx, input)), resumed: false };
  });
}

/** idそのままの取得。既に完了済みのリンクへ再アクセスした際の結果再表示用。 */
export async function getMbtiWebQuizSessionRecord(
  prisma: PrismaClient,
  sessionId: string,
): Promise<MbtiWebQuizSessionRecord | null> {
  const session = await prisma.mbtiWebQuizSession.findUnique({ where: { id: sessionId } });
  return session ? toRecord(session) : null;
}

export type MbtiWebQuizSessionResolution =
  | { ok: true; session: MbtiWebQuizSessionRecord }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_completed' };

/**
 * セッションをバリデーション付きで取得する。`pending`かつ有効期限切れの場合は、
 * 専用cronを設けずこの読み取りのタイミングで`status`を`expired`へ更新する(自己修復)。
 */
export async function resolveMbtiWebQuizSessionForAnswer(
  prisma: PrismaClient,
  sessionId: string,
): Promise<MbtiWebQuizSessionResolution> {
  const session = await prisma.mbtiWebQuizSession.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, reason: 'not_found' };

  if (session.status === 'pending' && session.expiresAt.getTime() <= Date.now()) {
    await prisma.mbtiWebQuizSession.updateMany({
      where: { id: sessionId, status: 'pending' },
      data: { status: 'expired' },
    });
    return { ok: false, reason: 'expired' };
  }

  if (session.status === 'expired') return { ok: false, reason: 'expired' };
  if (session.status === 'completed') {
    // 完了済みでも結果の再表示は元のexpiresAtまで。単発リンクが
    // 結果への無期限アクセス手段になってしまわないようにする。
    if (session.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'already_completed' };
  }

  return { ok: true, session: toRecord(session) };
}

/**
 * `WHERE status = 'pending'`ガード付きで回答を追記する。マッチしなければ(期限切れ・
 * 完了済み・不整合な二重送信)nullを返し、呼び出し元に再検証を促す。
 */
export async function appendMbtiWebQuizAnswer(
  prisma: PrismaClient,
  sessionId: string,
  answers: readonly MbtiWebQuizAnswer[],
  scores: Record<string, number>,
  previousAnswers: readonly MbtiWebQuizAnswer[],
): Promise<MbtiWebQuizSessionRecord | null> {
  const result = await prisma.mbtiWebQuizSession.updateMany({
    where: {
      id: sessionId,
      status: 'pending',
      expiresAt: { gt: new Date() },
      answers: { equals: previousAnswers as unknown as Prisma.InputJsonValue },
    },
    data: {
      answers: answers as unknown as object,
      scores: scores as unknown as object,
    },
  });
  if (result.count === 0) return null;

  const session = await prisma.mbtiWebQuizSession.findUnique({ where: { id: sessionId } });
  return session ? toRecord(session) : null;
}

export async function completeMbtiWebQuizSession(
  prisma: PrismaClient,
  sessionId: string,
  input: {
    resultType: string;
    resultIdentity: string;
    history: MbtiPersonalResultInput;
    stats: MbtiQuizCompletionInput;
    achievementIds?: readonly string[];
  },
): Promise<MbtiWebQuizSessionRecord | null> {
  if (
    input.history.resultType !== input.resultType ||
    input.history.resultIdentity !== input.resultIdentity ||
    input.stats.guildId !== input.history.guildId ||
    input.stats.resultType !== input.resultType
  )
    throw new Error('invalid_mbti_completion_scope');
  return prisma.$transaction(async (tx) => {
    const result = await tx.mbtiWebQuizSession.updateMany({
      where: {
        id: sessionId,
        guildId: input.history.guildId,
        discordUserId: input.history.discordUserId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      data: {
        status: 'completed',
        completedAt: input.history.completedAt,
        resultType: input.resultType,
        resultIdentity: input.resultIdentity,
      },
    });
    if (result.count === 0) return null;
    const saved = await saveMbtiPersonalResult(tx, input.history);
    if (saved.count) await recordMbtiQuizCompletionInTransaction(tx, input.stats);
    if (input.achievementIds?.length) {
      await syncAchievementUnlocksInTransaction(
        tx,
        input.history.guildId,
        input.history.discordUserId,
        input.achievementIds,
        input.history.completedAt,
      );
    }
    const session = await tx.mbtiWebQuizSession.findUnique({ where: { id: sessionId } });
    return session ? toRecord(session) : null;
  });
}

/** 回答内容を含むテーブルのため、保持期間を超えた行を削除する運用フック。専用cronは本PRでは設けない。 */
export async function pruneExpiredMbtiWebQuizSessions(
  prisma: PrismaClient,
  input: { olderThanDays: number },
): Promise<number> {
  const cutoff = new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.mbtiWebQuizSession.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

function toRecord(session: {
  id: string;
  guildId: string;
  discordUserId: string;
  status: string;
  questionOrder: unknown;
  answers: unknown;
  scores: unknown;
  resultType: string | null;
  resultIdentity: string | null;
  completedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}): MbtiWebQuizSessionRecord {
  return {
    id: session.id,
    guildId: session.guildId,
    discordUserId: session.discordUserId,
    status: session.status,
    questionOrder: session.questionOrder as MbtiWebQuizQuestion[],
    answers: session.answers as MbtiWebQuizAnswer[],
    scores: session.scores as Record<string, number>,
    resultType: session.resultType,
    resultIdentity: session.resultIdentity,
    completedAt: session.completedAt,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  };
}
