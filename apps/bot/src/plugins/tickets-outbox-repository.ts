import type { PrismaClient } from '@herta/db';
import {
  TICKET_MAX_ATTEMPTS,
  ticketRetryDelayMs,
  type TicketOutboxPayload,
} from './tickets-core.js';

const DUE_BATCH_LIMIT = 100;

/**
 * payload を outbox へ冪等に積む。sourceEventId の一意制約で重複を弾くため、
 * 同じ Discord メッセージを再観測しても二重配送にはならない (初回分の
 * body が正として残る)。関連する payload 群 (メッセージ本文とその添付
 * など) は1回の呼び出しで渡し、トランザクションで原子的に積む。片方だけ
 * が残る部分状態を作らないため、呼び出し側で分割して積んではいけない。
 */
export async function enqueueTicketPayloads(
  prisma: PrismaClient,
  guildId: string,
  payloads: readonly TicketOutboxPayload[],
): Promise<number> {
  if (payloads.length === 0) return 0;
  const [result] = await prisma.$transaction([
    prisma.ticketEventOutbox.createMany({
      data: payloads.map((payload) => ({
        sourceEventId: payload.sourceEventId,
        eventId: payload.eventId,
        guildId,
        kind: payload.kind,
        ticketId: payload.ticketId,
        body: payload.body,
      })),
      skipDuplicates: true,
    }),
  ]);
  return result?.count ?? 0;
}

export interface TicketOutboxRow {
  id: string;
  sourceEventId: string;
  eventId: string;
  guildId: string;
  kind: string;
  ticketId: string;
  body: string;
  attempts: number;
}

/** 送信対象 (未送信で、再送時刻が来ている) 行を古い順に取得する。 */
export async function listDueTicketOutboxRows(
  prisma: PrismaClient,
  guildId: string,
  now: Date,
  limit: number = DUE_BATCH_LIMIT,
): Promise<TicketOutboxRow[]> {
  const rows: TicketOutboxRow[] = await prisma.ticketEventOutbox.findMany({
    where: {
      guildId,
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
      kind: true,
      ticketId: true,
      body: true,
      attempts: true,
    },
  });
  return rows;
}

export async function markTicketOutboxSent(
  prisma: PrismaClient,
  id: string,
  status: number,
  now: Date,
): Promise<void> {
  await prisma.ticketEventOutbox.update({
    where: { id },
    data: { status: 'sent', lastStatus: status, lastError: null, sentAt: now },
  });
}

/** 403 / 409 / 422 は恒久扱い。再送せず、状態とHTTPステータスだけを残す。 */
export async function markTicketOutboxDropped(
  prisma: PrismaClient,
  id: string,
  status: number,
): Promise<void> {
  await prisma.ticketEventOutbox.update({
    where: { id },
    data: { status: 'dropped', lastStatus: status },
  });
}

/**
 * 401 は設定異常。行自体は pending のまま残し (呼び出し側が送信を停止する)、
 * 最後に受けたステータスだけを記録して可視化する。
 */
export async function touchTicketOutboxAuthFailure(
  prisma: PrismaClient,
  id: string,
  status: number,
): Promise<void> {
  await prisma.ticketEventOutbox.update({
    where: { id },
    data: { lastStatus: status, lastError: 'auth_failure' },
  });
}

/**
 * 再送可能エラーの記録。attempts を進め、バックオフ後の時刻を次回送信時刻にする。
 * 上限回数を超えたら failed にして自動再送を止める。true は failed 化を表す。
 */
export async function markTicketOutboxRetry(
  prisma: PrismaClient,
  row: Pick<TicketOutboxRow, 'id' | 'attempts'>,
  detail: { status?: number; error?: string },
  now: Date,
): Promise<boolean> {
  const attempts = row.attempts + 1;
  const failed = attempts >= TICKET_MAX_ATTEMPTS;
  await prisma.ticketEventOutbox.update({
    where: { id: row.id },
    data: {
      status: failed ? 'failed' : 'pending',
      attempts,
      nextAttemptAt: failed ? null : new Date(now.getTime() + ticketRetryDelayMs(attempts)),
      lastStatus: detail.status ?? null,
      lastError: detail.error ? detail.error.slice(0, 500) : null,
    },
  });
  return failed;
}

export interface TicketThreadLinkRecord {
  ticketId: string;
  guildId: string;
  channelId: string;
  threadId: string;
  requesterId: string;
  claimedById: string | null;
}

/** 起票直後にスレッド紐付けを Herta 側へ記録する (Web 配送は outbox が担う)。 */
export async function saveTicketThreadLink(
  prisma: PrismaClient,
  link: Omit<TicketThreadLinkRecord, 'claimedById'>,
): Promise<void> {
  await prisma.ticketThreadLink.upsert({
    where: { ticketId: link.ticketId },
    create: { ...link },
    update: {
      guildId: link.guildId,
      channelId: link.channelId,
      threadId: link.threadId,
      requesterId: link.requesterId,
    },
  });
}

/** メッセージがチケットのスレッド内のものか判定するための逆引き。 */
export async function findTicketThreadLinkByThreadId(
  prisma: PrismaClient,
  guildId: string,
  threadId: string,
): Promise<TicketThreadLinkRecord | null> {
  const row = await prisma.ticketThreadLink.findFirst({
    where: { guildId, threadId },
    select: {
      ticketId: true,
      guildId: true,
      channelId: true,
      threadId: true,
      requesterId: true,
      claimedById: true,
    },
  });
  return row ?? null;
}

/** Claim ボタンの記録 (Discord 内表示専用。Web 側の担当者は Admin で設定する)。 */
export async function setTicketThreadClaimedBy(
  prisma: PrismaClient,
  guildId: string,
  threadId: string,
  claimedById: string,
): Promise<TicketThreadLinkRecord | null> {
  const existing = await findTicketThreadLinkByThreadId(prisma, guildId, threadId);
  if (!existing) return null;
  const row = await prisma.ticketThreadLink.update({
    where: { ticketId: existing.ticketId },
    data: { claimedById },
    select: {
      ticketId: true,
      guildId: true,
      channelId: true,
      threadId: true,
      requesterId: true,
      claimedById: true,
    },
  });
  return row;
}
