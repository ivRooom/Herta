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

/**
 * 要約生成に失敗した場合。リトライ機構が存在しないため、segmentsを残したままにすると
 * 文字起こし本文が無期限に残り「本文はセッション中のみ保持する」というプライバシー方針
 * (docs/PRIVACY_POLICY.md)に反する。completeVcRecapSessionと同様にsegmentsも削除する。
 */
export async function failVcRecapSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.vcRecapSession.update({
      where: { id: sessionId },
      data: { status: 'failed', endedAt: new Date() },
    }),
    prisma.vcRecapTranscriptSegment.deleteMany({ where: { sessionId } }),
  ]);
}

export interface VcRecapSessionSummary {
  id: string;
  guildId: string;
  channelId: string;
  startedBy: string | null;
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
  startedBy: string | null;
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

const USER_EXPORT_PAGE_SIZE = 200;
/** 無限ループ防止の安全弁。本人のVC要約セッション数がこれを超えることは現実的に無い想定。 */
const USER_EXPORT_MAX_SESSIONS = 20_000;

/**
 * /herta-privacy exportのためのguildを跨いだ本人データ取得(エクスポート対象は本人の
 * データ全体であり、特定guildに限定しない)。プライバシーポリシーが「保持している
 * データ全体をエクスポートする」と約束しているため、件数を打ち切らず全件を取得する
 * (カーソルページングで内部的に分割取得し、呼び出し元には結合済みの配列を返す)。
 */
export async function listVcRecapSessionsForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<UserVcRecapSessionSummary[]> {
  const where: Prisma.VcRecapSessionWhereInput = {
    OR: [{ consentingUserIds: { has: userId } }, { nonConsentingUserIds: { has: userId } }],
  };

  const results: UserVcRecapSessionSummary[] = [];
  let cursor: { id: string } | undefined;
  for (;;) {
    const rows = await prisma.vcRecapSession.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: USER_EXPORT_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor } : {}),
    });
    for (const row of rows) {
      results.push({
        id: row.id,
        guildId: row.guildId,
        channelId: row.channelId,
        status: row.status,
        summary: row.summary,
        topics: row.topics,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        wasConsenting: row.consentingUserIds.includes(userId),
      });
    }
    if (rows.length < USER_EXPORT_PAGE_SIZE || results.length >= USER_EXPORT_MAX_SESSIONS) break;
    cursor = { id: rows[rows.length - 1]!.id };
  }
  return results;
}

export interface DeleteUserVoiceDataResult {
  deletedSessions: number;
  redactedSessions: number;
}

/**
 * 本人からの削除依頼(/herta-privacy delete-voice-data)に対応する。このユーザーが
 * 参加したVcRecapSessionのうち、他の参加者がいない(本人1人だけの)ものは行ごと削除し、
 * 他の参加者もいるものは本人のIDだけをconsenting/non-consentingの配列から除去する
 * (他の参加者のセッション記録自体は残す。本人のtranscript segmentsも合わせて削除し、
 * startedByが本人を指していた場合はnullにする)。
 *
 * 要約(summary/topics)は複数参加者の発言から生成された1つの文章であり、本人由来の
 * 内容だけを事後的に取り除くことはできない。そのため、本人を含むセッションを削除・
 * 再生成せず残す場合でも、要約は一律nullへ戻す(他の参加者には要約の消失という形で
 * 影響するが、不完全な匿名化で本人由来の内容を残すよりプライバシー保護を優先する)。
 *
 * 検索条件はconsenting/non-consentingの配列だけでなく、startedByと
 * VcRecapTranscriptSegment.userIdも含める(配列に本人が含まれないセッションの
 * startedByやsegmentsだけに本人の痕跡が残るケースを取りこぼさないため)。
 *
 * 配列からの除去はPostgresのarray_remove()でDB側に原子的に行わせる(アプリ側で読んだ
 * 配列をそのまま書き戻す実装だと、同時に別ユーザーの削除依頼が同じsessionに対して走った
 * 場合にlost updateが起き、先に処理された側の削除が後から上書きされ消えてしまう)。
 */
export async function deleteUserVoiceData(
  prisma: PrismaClient,
  userId: string,
): Promise<DeleteUserVoiceDataResult> {
  const sessions = await prisma.vcRecapSession.findMany({
    where: {
      OR: [
        { consentingUserIds: { has: userId } },
        { nonConsentingUserIds: { has: userId } },
        { startedBy: userId },
        { segments: { some: { userId } } },
      ],
    },
    select: { id: true },
  });

  let deletedSessions = 0;
  let redactedSessions = 0;

  for (const session of sessions) {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { consenting_user_ids: string[]; non_consenting_user_ids: string[] }[]
      >`
        UPDATE vc_recap_sessions
        SET consenting_user_ids = array_remove(consenting_user_ids, ${userId}),
            non_consenting_user_ids = array_remove(non_consenting_user_ids, ${userId}),
            started_by = CASE WHEN started_by = ${userId} THEN NULL ELSE started_by END,
            summary = NULL,
            topics = ARRAY[]::TEXT[]
        WHERE id = ${session.id}
        RETURNING consenting_user_ids, non_consenting_user_ids
      `;
      const updated = rows[0];
      if (!updated) return;

      await tx.vcRecapTranscriptSegment.deleteMany({
        where: { sessionId: session.id, userId },
      });

      const isEmpty =
        updated.consenting_user_ids.length === 0 && updated.non_consenting_user_ids.length === 0;
      if (isEmpty) {
        await tx.vcRecapSession.delete({ where: { id: session.id } });
        deletedSessions += 1;
      } else {
        redactedSessions += 1;
      }
    });
  }

  return { deletedSessions, redactedSessions };
}
