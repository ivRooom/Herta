import type { PrismaClient } from '@prisma/client';

/** @herta/shared/mbti-coreのMbtiQuestion/MbtiScores/MbtiSessionAnswerと同じ形。 */
export interface MbtiWebQuizQuestion {
  id: number;
  axis: string;
  prompt: string;
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

const DEFAULT_EXPIRES_IN_MS = 60 * 60 * 1000;

export async function createMbtiWebQuizSession(
  prisma: PrismaClient,
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
): Promise<MbtiWebQuizSessionRecord | null> {
  const result = await prisma.mbtiWebQuizSession.updateMany({
    where: { id: sessionId, status: 'pending' },
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
  input: { resultType: string; resultIdentity: string },
): Promise<MbtiWebQuizSessionRecord | null> {
  const result = await prisma.mbtiWebQuizSession.updateMany({
    where: { id: sessionId, status: 'pending' },
    data: {
      status: 'completed',
      completedAt: new Date(),
      resultType: input.resultType,
      resultIdentity: input.resultIdentity,
    },
  });
  if (result.count === 0) return null;

  const session = await prisma.mbtiWebQuizSession.findUnique({ where: { id: sessionId } });
  return session ? toRecord(session) : null;
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
