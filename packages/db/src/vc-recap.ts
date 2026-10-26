import type { Prisma, PrismaClient, VcRecapSessionStatus } from '@prisma/client';

/** 本文保存に同意した参加者の文字起こし本文を、セッション終了から保持する日数。 */
export const VC_RECAP_TRANSCRIPT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * セッション進行中に逐次書き込む(クラッシュ時のロス防止)。要約完了後、本文保存に同意した
 * 参加者の分だけVC_RECAP_TRANSCRIPT_RETENTION_DAYS日残し、それ以外は削除する。
 */
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
 * 要約生成が完了したら呼ぶ。summary/topics/statusを保存し、本文保存に同意した参加者
 * (retainedUserIds)以外の本文(segments)を削除する。残した本文は
 * purgeExpiredVcRecapTranscriptsが保持期間の経過後に削除する(docs/PRIVACY_POLICY.md)。
 */
export async function completeVcRecapSession(
  prisma: PrismaClient,
  sessionId: string,
  input: { summary: string; topics: string[]; retainedUserIds?: readonly string[] },
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
    deleteUnretainedSegments(prisma, sessionId, input.retainedUserIds ?? []),
  ]);
}

/**
 * 要約生成に失敗した場合。リトライ機構が存在しないため、本文保存に同意していない参加者の
 * segmentsを残したままにするとプライバシー方針(docs/PRIVACY_POLICY.md)に反する。
 * completeVcRecapSessionと同様に、本文保存に同意した参加者の分だけ保持期間まで残す。
 */
export async function failVcRecapSession(
  prisma: PrismaClient,
  sessionId: string,
  retainedUserIds: readonly string[] = [],
): Promise<void> {
  await prisma.$transaction([
    prisma.vcRecapSession.update({
      where: { id: sessionId },
      data: { status: 'failed', endedAt: new Date() },
    }),
    deleteUnretainedSegments(prisma, sessionId, retainedUserIds),
  ]);
}

function deleteUnretainedSegments(
  prisma: PrismaClient,
  sessionId: string,
  retainedUserIds: readonly string[],
) {
  return prisma.vcRecapTranscriptSegment.deleteMany({
    where: {
      sessionId,
      ...(retainedUserIds.length > 0 ? { userId: { notIn: [...retainedUserIds] } } : {}),
    },
  });
}

/**
 * 保持期間(セッション終了からVC_RECAP_TRANSCRIPT_RETENTION_DAYS日)を過ぎた本文を削除する。
 * 進行中(endedAt=null)のセッションは対象外。戻り値は削除したsegment数(ログ用)。
 */
export async function purgeExpiredVcRecapTranscripts(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const result = await prisma.vcRecapTranscriptSegment.deleteMany({
    where: { session: { endedAt: { lt: transcriptRetentionCutoff(now) } } },
  });
  return result.count;
}

/** セッションごとの保存済み文字起こしsegment数。一覧で本文の有無を示すために使う。 */
export async function countVcRecapTranscriptSegments(
  prisma: PrismaClient,
  sessionIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await prisma.vcRecapTranscriptSegment.groupBy({
    by: ['sessionId'],
    // 本文保存に同意していない参加者の本文は、終了処理(endedAtを立てるのと同じtransaction)で
    // 消える。進行中・要約中のセッションはまだ残っているため数えない。保持期間を過ぎた分も
    // 削除ジョブの実行を待たずに数えない。
    where: {
      sessionId: { in: [...sessionIds] },
      session: { endedAt: { not: null, gt: transcriptRetentionCutoff(now) } },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.sessionId, row._count._all]));
}

export interface VcRecapSessionTranscript {
  session: VcRecapSessionSummary;
  segments: VcRecapTranscriptSegmentRecord[];
}

/**
 * Studioのセッション詳細用。guildIdが一致しないセッションは存在しないものとして扱う
 * (URLのsessionIdだけで他guildの本文を読めないようにする)。
 */
export async function getVcRecapSessionTranscriptForGuild(
  prisma: PrismaClient,
  guildId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<VcRecapSessionTranscript | null> {
  const row = await prisma.vcRecapSession.findFirst({
    where: { id: sessionId, guildId },
    include: {
      segments: {
        orderBy: { startedAt: 'asc' },
        select: { userId: true, text: true, startedAt: true, endedAt: true },
      },
    },
  });
  if (!row) return null;
  // endedAtは本文保存に同意していない参加者の本文を消すのと同じtransactionで立つ。
  // 未終了のセッションには未同意者の本文が残っているため返さない。保持期間を過ぎた本文も
  // 削除ジョブの実行を待たずに返さない。
  const visible = row.endedAt !== null && row.endedAt > transcriptRetentionCutoff(now);
  return { session: toVcRecapSessionSummary(row), segments: visible ? row.segments : [] };
}

function transcriptRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - VC_RECAP_TRANSCRIPT_RETENTION_DAYS * DAY_MS);
}

/** 本人の文字起こし本文(/herta-privacy exportで保持データ全体を返すため)。 */
export async function listVcRecapTranscriptSegmentsForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<(VcRecapTranscriptSegmentRecord & { sessionId: string })[]> {
  return prisma.vcRecapTranscriptSegment.findMany({
    where: { userId },
    orderBy: [{ sessionId: 'asc' }, { startedAt: 'asc' }],
    select: { sessionId: true, userId: true, text: true, startedAt: true, endedAt: true },
  });
}

/**
 * セッション開始後に新たにVCへ参加し、発言した同意済みユーザーを永続化された参加者配列へ
 * 追加する。これを行わないと、listVcRecapSessionsForUser/deleteUserVoiceDataが参加者配列
 * でセッションを検索する際にこのユーザーのセッションを見つけられず、本人が自分の発言から
 * 生成された要約をエクスポート・削除できなくなる。
 */
export async function addVcRecapSessionParticipant(
  prisma: PrismaClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  await prisma.vcRecapSession.update({
    where: { id: sessionId },
    data: { consentingUserIds: { push: userId } },
  });
}

/**
 * bot起動時に呼ぶ。`active`/`summarizing`のまま残っているセッションはプロセス再起動で
 * 進行中だった録音・要約処理が失われており、再開する仕組みも無い。本文を長期保持しない
 * プライバシー方針(docs/PRIVACY_POLICY.md)に反するまま残り続けないよう、failed扱いにして
 * segmentsを削除する。戻り値は後始末したセッション数(ログ用)。
 */
export async function reconcileStaleVcRecapSessions(prisma: PrismaClient): Promise<number> {
  const stale = await prisma.vcRecapSession.findMany({
    where: { status: { in: ['active', 'summarizing'] } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  await prisma.$transaction([
    prisma.vcRecapSession.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: 'failed', endedAt: new Date() },
    }),
    prisma.vcRecapTranscriptSegment.deleteMany({
      where: { sessionId: { in: stale.map((row) => row.id) } },
    }),
  ]);
  return stale.length;
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
