import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * apps/bot/src/plugins/activity-log-repository.tsのMemberActivityEventType相当。
 * packages/dbはapps/bot/src/をimportできないため、同じ文字列集合を独立して保持する
 * (mbti-stats-analytics.tsが独自にMbtiAxis等を再定義しているのと同じ事情)。
 */
export type MemberActivityFeedItem = {
  id: string;
  userId: string | null;
  event: string;
  channelId: string | null;
  messageId: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
};

export interface MemberActivityFeedFilters {
  guildId: string;
  from?: Date | null;
  toExclusive?: Date | null;
  /** event種別・userId・channelId・messageIdに対する部分一致検索(大小無視)。 */
  query?: string | null;
  page?: number;
  pageSize?: number;
}

const MAX_QUERY_LENGTH = 100;

export interface MemberActivityFeedResult {
  items: MemberActivityFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/**
 * Studioの監査ログ統合ビュー向けに、Discord側のgatewayイベント(メッセージ編集/削除・
 * チャンネル作成/削除・Role付与等)をguildId+期間で検索する。本文(メッセージ内容)は
 * 一覧表示に含めない(PIIを統合ビューへ漏らさない)。
 */
export async function searchMemberActivityEvents(
  prisma: PrismaClient,
  filters: MemberActivityFeedFilters,
): Promise<MemberActivityFeedResult> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const occurredAt: Prisma.DateTimeFilter = {};
  if (filters.from) occurredAt.gte = filters.from;
  if (filters.toExclusive) occurredAt.lt = filters.toExclusive;

  const query = filters.query?.trim().slice(0, MAX_QUERY_LENGTH) || null;

  const where: Prisma.MemberActivityEventWhereInput = {
    guildId: filters.guildId,
    ...(filters.from || filters.toExclusive ? { occurredAt } : {}),
    ...(query
      ? {
          OR: [
            { event: { contains: query, mode: 'insensitive' } },
            { userId: { contains: query, mode: 'insensitive' } },
            { channelId: { contains: query, mode: 'insensitive' } },
            { messageId: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const total = await prisma.memberActivityEvent.count({ where });
  // 保持期間のpruneやイベント発生タイミングの関係で件数が変わった後に古いpage番号で
  // リクエストされた場合、clampせずにそのままskipへ使うと「以前のページにはデータが
  // あるのに空結果」になってしまう。searchCommandExecutionEventsと同じ考え方でここでも
  // 必ずclampする。
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const rows = await prisma.memberActivityEvent.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    skip: (clampedPage - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      userId: true,
      event: true,
      channelId: true,
      messageId: true,
      metadata: true,
      occurredAt: true,
    },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      event: row.event,
      channelId: row.channelId,
      messageId: row.messageId,
      metadata: row.metadata as Record<string, unknown> | null,
      occurredAt: row.occurredAt.toISOString(),
    })),
    total,
    page: clampedPage,
    pageSize,
    totalPages,
  };
}
