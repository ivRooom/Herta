import type { PrismaClient, VcRecapSessionStatus, VcRecapSessionSummary } from '@herta/db';
import { listVcRecapSessions } from '@herta/db';
import { resolveGuildMemberDisplays, type GuildMemberOption } from './bot-guild-members.ts';
import { getGuildConfigurationOptions } from './bot-guild-options.ts';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/u;

export interface VcRecapQuery {
  page: number;
  pageSize: number;
  /** 空文字は「すべてのVC」を意味する。 */
  channelId: string;
}

export function parseVcRecapQuery(searchParams: URLSearchParams): VcRecapQuery {
  const channelIdValue = (searchParams.get('channelId') ?? '').trim();
  return {
    page: parsePositiveInteger(searchParams.get('page'), 1),
    pageSize: Math.min(
      parsePositiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    ),
    channelId: DISCORD_SNOWFLAKE.test(channelIdValue) ? channelIdValue : '',
  };
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface VcRecapParticipantDisplay {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface VcRecapSessionDisplay {
  id: string;
  channelId: string;
  channelName: string;
  status: VcRecapSessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  summary: string | null;
  topics: string[];
  consentingParticipants: VcRecapParticipantDisplay[];
  nonConsentingParticipants: VcRecapParticipantDisplay[];
}

/**
 * I/Oを含まない純粋関数。Bot/Prisma呼び出し結果の`Map`を渡すだけでユニットテストできる。
 * 解決できないID(Bot停止中・メンバー脱退等)は例外を投げず、生IDベースの表示へ
 * フォールバックする。
 */
export function toVcRecapSessionDisplay(
  session: VcRecapSessionSummary,
  memberDisplays: ReadonlyMap<string, GuildMemberOption>,
  channelNames: ReadonlyMap<string, string>,
): VcRecapSessionDisplay {
  const resolveParticipant = (userId: string): VcRecapParticipantDisplay => {
    const member = memberDisplays.get(userId);
    return {
      id: userId,
      displayName: member?.displayName ?? `Unknown User (${userId})`,
      avatarUrl: member?.avatarUrl ?? null,
    };
  };

  return {
    id: session.id,
    channelId: session.channelId,
    channelName: channelNames.get(session.channelId) ?? `#${session.channelId}`,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    summary: session.summary,
    topics: session.topics,
    consentingParticipants: session.consentingUserIds.map(resolveParticipant),
    nonConsentingParticipants: session.nonConsentingUserIds.map(resolveParticipant),
  };
}

export interface VcRecapChannelOption {
  id: string;
  name: string;
}

export interface VcRecapStudioResult {
  items: VcRecapSessionDisplay[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** フィルタ用の選択肢。Bot未稼働時でもこのguildの履歴に登場したVCは一覧できる。 */
  channelOptions: VcRecapChannelOption[];
}

export async function listVcRecapSessionsForStudio(
  prisma: PrismaClient,
  guildId: string,
  query: VcRecapQuery,
): Promise<VcRecapStudioResult> {
  const [result, distinctChannelRows, discordOptions] = await Promise.all([
    listVcRecapSessions(prisma, {
      guildId,
      channelId: query.channelId || undefined,
      page: query.page,
      pageSize: query.pageSize,
    }),
    // Prisma v6のfindMany({ distinct })はSQLのDISTINCT ONではなく、一致行を全件取得して
    // メモリ上で重複排除する。セッション数が増えるほど無駄な全件フェッチになるため、
    // SQLのGROUP BYへ変換されるgroupByを使う。
    prisma.vcRecapSession.groupBy({
      by: ['channelId'],
      where: { guildId },
      orderBy: { channelId: 'asc' },
    }),
    getGuildConfigurationOptions(guildId),
  ]);

  const allUserIds = [
    ...new Set(
      result.items.flatMap((item) => [...item.consentingUserIds, ...item.nonConsentingUserIds]),
    ),
  ];
  const memberDisplays = await resolveGuildMemberDisplays(guildId, allUserIds);

  const channelNames = new Map(
    (discordOptions?.messageTargets ?? [])
      .filter((option) => option.kind === 'voice')
      .map((option) => [option.id, option.name] as const),
  );

  const channelOptions: VcRecapChannelOption[] = distinctChannelRows.map((row) => ({
    id: row.channelId,
    name: channelNames.get(row.channelId) ?? `#${row.channelId}`,
  }));

  return {
    items: result.items.map((item) => toVcRecapSessionDisplay(item, memberDisplays, channelNames)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    channelOptions,
  };
}
