import type { PrismaClient } from '@herta/db';
import {
  ACTIVITY_XP_MAX_ATTEMPTS,
  activityXpRetryDelayMs,
  buildActivityXpOutboxPayload,
  computeVoiceMinutesInWindow,
  type ActivityXpOutboxPayload,
  type VoiceActivityEvent,
} from './activity-xp-ivrm-emitter.js';

/**
 * 窓開始時点で接続中かどうかを判定するため、voice event を遡って読む期間。
 * これより長く連続接続している場合は窓開始直前の join が拾えず過小になるが、
 * Discord の接続が7日を超えて継続することは実質なく、日次上限の範囲でもある。
 */
export const ACTIVITY_XP_VOICE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const DUE_BATCH_LIMIT = 200;

/**
 * 1時間窓の集計を `member_activity_events` から読み、outbox payload を作る。
 *
 * - message: 窓内の message_create 件数をユーザー別に数える。bot・webhook は
 *   Activity Log の記録時点で除外済み。
 * - voice: voice_join / voice_leave の時系列から computeVoiceMinutesInWindow で
 *   窓内の接続分数を求める。
 *
 * 注意: 集計元は Activity Log Plugin の記録 (guild ごとの Plugin 設定で
 * enabled / trackMessages / trackVoice が有効な範囲) に依存する。除外チャンネル・
 * 除外ロールの活動は記録されないため、この集計にも含まれない。
 */
export async function collectActivityXpPayloads(
  prisma: PrismaClient,
  guildId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<ActivityXpOutboxPayload[]> {
  const payloads: ActivityXpOutboxPayload[] = [];

  const messageRows = await prisma.memberActivityEvent.groupBy({
    by: ['userId'],
    where: {
      guildId,
      event: 'message_create',
      occurredAt: { gte: windowStart, lt: windowEnd },
      userId: { not: null },
    },
    _count: { _all: true },
  });
  for (const row of messageRows) {
    if (!row.userId) continue;
    const payload = buildActivityXpOutboxPayload({
      guildId,
      discordUserId: row.userId,
      eventType: 'message',
      count: row._count._all,
      windowStart,
    });
    if (payload) payloads.push(payload);
  }

  const voiceRows = await prisma.memberActivityEvent.findMany({
    where: {
      guildId,
      event: { in: ['voice_join', 'voice_leave'] },
      occurredAt: {
        gte: new Date(windowStart.getTime() - ACTIVITY_XP_VOICE_LOOKBACK_MS),
        lt: windowEnd,
      },
      userId: { not: null },
    },
    select: { userId: true, event: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  });
  const voiceEventsByUser = new Map<string, VoiceActivityEvent[]>();
  for (const row of voiceRows) {
    if (!row.userId) continue;
    if (row.event !== 'voice_join' && row.event !== 'voice_leave') continue;
    const list = voiceEventsByUser.get(row.userId) ?? [];
    list.push({ event: row.event, occurredAt: row.occurredAt });
    voiceEventsByUser.set(row.userId, list);
  }
  for (const [userId, events] of voiceEventsByUser) {
    const minutes = computeVoiceMinutesInWindow(events, windowStart, windowEnd);
    const payload = buildActivityXpOutboxPayload({
      guildId,
      discordUserId: userId,
      eventType: 'voice',
      count: minutes,
      windowStart,
    });
    if (payload) payloads.push(payload);
  }

  return payloads;
}

/**
 * payload を outbox へ冪等に積む。sourceEventId の一意制約で重複を弾くため、
 * 同じ窓を再集計しても二重にはならない (ただし初回分の body が正として残る)。
 */
export async function enqueueActivityXpPayloads(
  prisma: PrismaClient,
  payloads: readonly ActivityXpOutboxPayload[],
): Promise<number> {
  if (payloads.length === 0) return 0;
  const result = await prisma.activityXpEventOutbox.createMany({
    data: payloads.map((payload) => ({
      sourceEventId: payload.sourceEventId,
      eventId: payload.eventId,
      guildId: payload.guildId,
      userId: payload.userId,
      eventType: payload.eventType,
      body: payload.body,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export interface ActivityXpOutboxRow {
  id: string;
  sourceEventId: string;
  eventId: string;
  guildId: string;
  body: string;
  attempts: number;
}

/** 送信対象 (未送信で、再送時刻が来ている) 行を古い順に取得する。 */
export async function listDueActivityXpOutboxRows(
  prisma: PrismaClient,
  now: Date,
  limit: number = DUE_BATCH_LIMIT,
): Promise<ActivityXpOutboxRow[]> {
  const rows = await prisma.activityXpEventOutbox.findMany({
    where: {
      status: 'pending',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      sourceEventId: true,
      eventId: true,
      guildId: true,
      body: true,
      attempts: true,
    },
  });
  return rows;
}

export async function markActivityXpOutboxSent(
  prisma: PrismaClient,
  id: string,
  status: number,
  now: Date,
): Promise<void> {
  await prisma.activityXpEventOutbox.update({
    where: { id },
    data: { status: 'sent', lastStatus: status, lastError: null, sentAt: now },
  });
}

/** 409 / 422 は恒久扱い。再送せず、状態とHTTPステータスだけを残す。 */
export async function markActivityXpOutboxDropped(
  prisma: PrismaClient,
  id: string,
  status: number,
): Promise<void> {
  await prisma.activityXpEventOutbox.update({
    where: { id },
    data: { status: 'dropped', lastStatus: status },
  });
}

/**
 * 401 / 403 は設定異常。行自体は pending のまま残し (呼び出し側が送信を停止する)、
 * 最後に受けたステータスだけを記録して可視化する。
 */
export async function touchActivityXpOutboxAuthFailure(
  prisma: PrismaClient,
  id: string,
  status: number,
): Promise<void> {
  await prisma.activityXpEventOutbox.update({
    where: { id },
    data: { lastStatus: status, lastError: 'auth_failure' },
  });
}

/**
 * 再送可能エラーの記録。attempts を進め、バックオフ後の時刻を次回送信時刻にする。
 * 上限回数を超えたら failed にして自動再送を止める。true は failed 化を表す。
 */
export async function markActivityXpOutboxRetry(
  prisma: PrismaClient,
  row: Pick<ActivityXpOutboxRow, 'id' | 'attempts'>,
  detail: { status?: number; error?: string },
  now: Date,
): Promise<boolean> {
  const attempts = row.attempts + 1;
  const failed = attempts >= ACTIVITY_XP_MAX_ATTEMPTS;
  await prisma.activityXpEventOutbox.update({
    where: { id: row.id },
    data: {
      status: failed ? 'failed' : 'pending',
      attempts,
      nextAttemptAt: failed ? null : new Date(now.getTime() + activityXpRetryDelayMs(attempts)),
      lastStatus: detail.status ?? null,
      lastError: detail.error ? detail.error.slice(0, 500) : null,
    },
  });
  return failed;
}
