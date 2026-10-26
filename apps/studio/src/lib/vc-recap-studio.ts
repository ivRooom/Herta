import type {
  PrismaClient,
  VcRecapSessionStatus,
  VcRecapSessionSummary,
  VcRecapTranscriptSegmentRecord,
} from '@herta/db';
import {
  VC_RECAP_TRANSCRIPT_RETENTION_DAYS,
  countVcRecapTranscriptSegments,
  getVcRecapSessionTranscriptForGuild,
  listVcRecapSessions,
} from '@herta/db';
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
  /** 保存中の文字起こし本文の件数(本文保存に同意した参加者の分のみ)。 */
  transcriptSegmentCount: number;
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
  transcriptSegmentCount = 0,
): VcRecapSessionDisplay {
  const resolveParticipant = (userId: string) => resolveParticipantDisplay(memberDisplays, userId);

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
    transcriptSegmentCount,
  };
}

function resolveParticipantDisplay(
  memberDisplays: ReadonlyMap<string, GuildMemberOption>,
  userId: string,
): VcRecapParticipantDisplay {
  const member = memberDisplays.get(userId);
  return {
    id: userId,
    displayName: member?.displayName ?? `Unknown User (${userId})`,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

export interface VcRecapTranscriptEntry {
  speaker: VcRecapParticipantDisplay;
  text: string;
  startedAt: Date;
  endedAt: Date;
}

/** 発言時刻順のsegmentを、発言者の表示名を解決したタイムライン用の行へ変換する。 */
export function toVcRecapTranscriptEntries(
  segments: readonly VcRecapTranscriptSegmentRecord[],
  memberDisplays: ReadonlyMap<string, GuildMemberOption>,
): VcRecapTranscriptEntry[] {
  return segments.map((segment) => ({
    speaker: resolveParticipantDisplay(memberDisplays, segment.userId),
    text: segment.text,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
  }));
}

/** 本文の削除予定日時(セッション終了からVC_RECAP_TRANSCRIPT_RETENTION_DAYS日後)。 */
export function vcRecapTranscriptExpiresAt(endedAt: Date | null): Date | null {
  if (!endedAt) return null;
  return new Date(endedAt.getTime() + VC_RECAP_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export interface VcRecapSessionDetail {
  session: VcRecapSessionDisplay;
  transcript: VcRecapTranscriptEntry[];
  transcriptExpiresAt: Date | null;
}

export async function getVcRecapSessionDetailForStudio(
  prisma: PrismaClient,
  guildId: string,
  sessionId: string,
): Promise<VcRecapSessionDetail | null> {
  const [found, discordOptions] = await Promise.all([
    getVcRecapSessionTranscriptForGuild(prisma, guildId, sessionId),
    getGuildConfigurationOptions(guildId),
  ]);
  if (!found) return null;

  const userIds = [
    ...new Set([
      ...found.session.consentingUserIds,
      ...found.session.nonConsentingUserIds,
      ...found.segments.map((segment) => segment.userId),
    ]),
  ];
  const memberDisplays = await resolveGuildMemberDisplays(guildId, userIds);
  const channelNames = new Map(
    (discordOptions?.messageTargets ?? [])
      .filter((option) => option.kind === 'voice')
      .map((option) => [option.id, option.name] as const),
  );

  return {
    session: toVcRecapSessionDisplay(
      found.session,
      memberDisplays,
      channelNames,
      found.segments.length,
    ),
    transcript: toVcRecapTranscriptEntries(found.segments, memberDisplays),
    transcriptExpiresAt: vcRecapTranscriptExpiresAt(found.session.endedAt),
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
  const [memberDisplays, transcriptCounts] = await Promise.all([
    resolveGuildMemberDisplays(guildId, allUserIds),
    countVcRecapTranscriptSegments(
      prisma,
      result.items.map((item) => item.id),
    ),
  ]);

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
    items: result.items.map((item) =>
      toVcRecapSessionDisplay(item, memberDisplays, channelNames, transcriptCounts.get(item.id)),
    ),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    channelOptions,
  };
}

export interface VcRecapTimelineDay {
  /** JSTの日付キー(YYYY-MM-DD)。 */
  dateKey: string;
  items: VcRecapSessionDisplay[];
}

const JST_DATE_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 開始日時の降順に並んだセッションを、並び順を保ったままJSTの日付ごとにまとめる。 */
export function groupVcRecapSessionsByDay(items: VcRecapSessionDisplay[]): VcRecapTimelineDay[] {
  const days: VcRecapTimelineDay[] = [];
  for (const item of items) {
    const dateKey = JST_DATE_KEY_FORMAT.format(item.startedAt);
    const last = days[days.length - 1];
    if (last?.dateKey === dateKey) {
      last.items.push(item);
    } else {
      days.push({ dateKey, items: [item] });
    }
  }
  return days;
}

/** 開始〜終了の経過時間を「1時間5分」のように表す。終了していない場合はnull。 */
export function formatVcRecapDuration(startedAt: Date, endedAt: Date | null): string | null {
  if (!endedAt) return null;
  const totalMinutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
  if (totalMinutes < 1) return '1分未満';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}
