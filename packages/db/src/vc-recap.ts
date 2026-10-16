import type { Prisma, PrismaClient, VcRecapSessionStatus } from '@prisma/client';

export interface StartVcRecapSessionInput {
  guildId: string;
  channelId: string;
  startedBy: string;
  consentingUserIds: string[];
  nonConsentingUserIds: string[];
}

export async function startVcRecapSession(
  prisma: PrismaClient,
  input: StartVcRecapSessionInput,
): Promise<{ id: string }> {
  return prisma.vcRecapSession.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      startedBy: input.startedBy,
      consentingUserIds: input.consentingUserIds,
      nonConsentingUserIds: input.nonConsentingUserIds,
    },
    select: { id: true },
  });
}

export interface AppendVcRecapTranscriptSegmentInput {
  sessionId: string;
  userId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
}

/** セッション進行中に逐次書き込む(クラッシュ時のロス防止)。本文は要約完了後に削除される。 */
export async function appendVcRecapTranscriptSegment(
  prisma: PrismaClient,
  input: AppendVcRecapTranscriptSegmentInput,
): Promise<void> {
  await prisma.vcRecapTranscriptSegment.create({
    data: {
      sessionId: input.sessionId,
      userId: input.userId,
      text: input.text,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    },
  });
}

export interface VcRecapTranscriptSegmentRecord {
  userId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
}

export async function listVcRecapTranscriptSegments(
  prisma: PrismaClient,
  sessionId: string,
): Promise<VcRecapTranscriptSegmentRecord[]> {
  return prisma.vcRecapTranscriptSegment.findMany({
    where: { sessionId },
    orderBy: { startedAt: 'asc' },
    select: { userId: true, text: true, startedAt: true, endedAt: true },
  });
}

export async function markVcRecapSessionSummarizing(
  prisma: PrismaClient,
  sessionId: string,
): Promise<void> {
  await prisma.vcRecapSession.update({
    where: { id: sessionId },
    data: { status: 'summarizing' },
  });
}

/**
 * 要約生成が完了したら呼ぶ。summary/topics/statusを保存し、本文(segments)を削除する
 * (本文を長期保持しないプライバシー設計、PR計画のPhase 0参照)。
 */
export async function completeVcRecapSession(
  prisma: PrismaClient,
  sessionId: string,
  input: { summary: string; topics: string[] },
): Promise<void> {
  await prisma.$transaction([
    prisma.vcRecapSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        summary: input.summary,
        topics: input.topics,
        endedAt: new Date(),
      },
    }),
    prisma.vcRecapTranscriptSegment.deleteMany({ where: { sessionId } }),
  ]);
}

/** 要約生成に失敗した場合。segmentsは残したまま(リトライ可能にするため)statusだけ更新する。 */
export async function failVcRecapSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.vcRecapSession.update({
    where: { id: sessionId },
    data: { status: 'failed', endedAt: new Date() },
  });
}

export interface VcRecapSessionSummary {
  id: string;
  guildId: string;
  channelId: string;
  startedBy: string;
  status: VcRecapSessionStatus;
  consentingUserIds: string[];
  nonConsentingUserIds: string[];
  summary: string | null;
  topics: string[];
  startedAt: Date;
  endedAt: Date | null;
}

function toVcRecapSessionSummary(row: {
  id: string;
  guildId: string;
  channelId: string;
  startedBy: string;
  status: VcRecapSessionStatus;
  consentingUserIds: string[];
  nonConsentingUserIds: string[];
  summary: string | null;
  topics: string[];
  startedAt: Date;
  endedAt: Date | null;
}): VcRecapSessionSummary {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    startedBy: row.startedBy,
    status: row.status,
    consentingUserIds: row.consentingUserIds,
    nonConsentingUserIds: row.nonConsentingUserIds,
    summary: row.summary,
    topics: row.topics,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export async function getVcRecapSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<VcRecapSessionSummary | null> {
  const row = await prisma.vcRecapSession.findUnique({ where: { id: sessionId } });
  return row ? toVcRecapSessionSummary(row) : null;
}

export interface ListVcRecapSessionsFilters {
  guildId: string;
  channelId?: string;
  /** 指定した場合、このユーザーが参加した(同意/不同意いずれも)セッションのみに絞る。 */
  participantUserId?: string;
  page?: number;
  pageSize?: number;
}

export interface ListVcRecapSessionsResult {
  items: VcRecapSessionSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export async function listVcRecapSessions(
  prisma: PrismaClient,
  filters: ListVcRecapSessionsFilters,
): Promise<ListVcRecapSessionsResult> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const where: Prisma.VcRecapSessionWhereInput = {
    guildId: filters.guildId,
    ...(filters.channelId ? { channelId: filters.channelId } : {}),
    ...(filters.participantUserId
      ? {
          OR: [
            { consentingUserIds: { has: filters.participantUserId } },
            { nonConsentingUserIds: { has: filters.participantUserId } },
          ],
        }
      : {}),
  };

  const total = await prisma.vcRecapSession.count({ where });
  // 保持件数の変化やpruneで古いpage番号が空結果になるのを防ぐため、既存のsearchXxx系と
  // 同じくcount→totalPages算出→clampしたpageでskip/takeする。
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, totalPages);

  const rows = await prisma.vcRecapSession.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    skip: (clampedPage - 1) * pageSize,
    take: pageSize,
  });

  return {
    items: rows.map(toVcRecapSessionSummary),
    total,
    page: clampedPage,
    pageSize,
    totalPages,
  };
}

export interface UserVcRecapSessionSummary {
  id: string;
  guildId: string;
  channelId: string;
  status: VcRecapSessionStatus;
  summary: string | null;
  topics: string[];
  startedAt: Date;
  endedAt: Date | null;
  wasConsenting: boolean;
}

/**
 * /herta-privacy exportのためのguildを跨いだ本人データ取得(エクスポート対象は本人の
 * データ全体であり、特定guildに限定しない)。
 */
export async function listVcRecapSessionsForUser(
  prisma: PrismaClient,
  userId: string,
  limit = 50,
): Promise<UserVcRecapSessionSummary[]> {
  const rows = await prisma.vcRecapSession.findMany({
    where: {
      OR: [{ consentingUserIds: { has: userId } }, { nonConsentingUserIds: { has: userId } }],
    },
    orderBy: { startedAt: 'desc' },
    take: Math.max(1, Math.min(200, Math.trunc(limit))),
  });
  return rows.map((row) => ({
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    status: row.status,
    summary: row.summary,
    topics: row.topics,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    wasConsenting: row.consentingUserIds.includes(userId),
  }));
}

export interface DeleteUserVoiceDataResult {
  deletedSessions: number;
  redactedSessions: number;
}

/**
 * 本人からの削除依頼(/herta-privacy delete-voice-data)に対応する。このユーザーが
 * 参加したVcRecapSessionのうち、他の参加者がいない(本人1人だけの)ものは行ごと削除し、
 * 他の参加者もいるものは本人のIDだけをconsenting/non-consentingの配列から除去する
 * (他の参加者のセッション記録自体は残す。本人のtranscript segmentsも合わせて削除する)。
 */
export async function deleteUserVoiceData(
  prisma: PrismaClient,
  userId: string,
): Promise<DeleteUserVoiceDataResult> {
  const sessions = await prisma.vcRecapSession.findMany({
    where: {
      OR: [{ consentingUserIds: { has: userId } }, { nonConsentingUserIds: { has: userId } }],
    },
    select: { id: true, consentingUserIds: true, nonConsentingUserIds: true },
  });

  let deletedSessions = 0;
  let redactedSessions = 0;
  for (const session of sessions) {
    const remainingConsenting = session.consentingUserIds.filter((id) => id !== userId);
    const remainingNonConsenting = session.nonConsentingUserIds.filter((id) => id !== userId);
    const soleParticipant = remainingConsenting.length === 0 && remainingNonConsenting.length === 0;

    if (soleParticipant) {
      await prisma.vcRecapSession.delete({ where: { id: session.id } });
      deletedSessions += 1;
    } else {
      await prisma.vcRecapSession.update({
        where: { id: session.id },
        data: {
          consentingUserIds: remainingConsenting,
          nonConsentingUserIds: remainingNonConsenting,
        },
      });
      await prisma.vcRecapTranscriptSegment.deleteMany({
        where: { sessionId: session.id, userId },
      });
      redactedSessions += 1;
    }
  }

  return { deletedSessions, redactedSessions };
}
