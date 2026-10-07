import type { Prisma, PrismaClient } from '@herta/db';

export const MEMBER_ACTIVITY_EVENT_TYPES = [
  'voice_join',
  'voice_leave',
  'message_create',
  'message_update',
  'message_delete',
  'emoji_create',
  'emoji_update',
  'emoji_delete',
  'avatar_update',
  'nickname_update',
  'role_add',
  'role_remove',
  'guild_icon_update',
  'guild_banner_update',
] as const;

export type MemberActivityEventType = (typeof MEMBER_ACTIVITY_EVENT_TYPES)[number];

export interface RecordMemberActivityEventInput {
  guildId: string;
  userId: string | null;
  event: MemberActivityEventType;
  channelId?: string | null;
  messageId?: string | null;
  /** message_update(編集前)・message_delete(削除時)の本文スナップショット。未取得時はnull。 */
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

export async function recordMemberActivityEvent(
  prisma: PrismaClient,
  input: RecordMemberActivityEventInput,
): Promise<void> {
  await prisma.memberActivityEvent.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      event: input.event,
      channelId: input.channelId ?? null,
      messageId: input.messageId ?? null,
      content: input.content ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

/**
 * occurredAtがretentionDaysより古く、contentが残っているレコードのcontentだけをnullにする
 * (メタデータ・event種別・timestampは保持期間を設けず永続保持する)。戻り値はscrub件数。
 */
export async function scrubExpiredMemberActivityContent(
  prisma: PrismaClient,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.memberActivityEvent.updateMany({
    where: { occurredAt: { lt: cutoff }, content: { not: null } },
    data: { content: null, contentScrubbedAt: new Date() },
  });
  return result.count;
}

export interface CountRecentUserEventsInput {
  guildId: string;
  userId: string;
  event: MemberActivityEventType;
  since: Date;
}

/** 直近since以降の、guild+user+event種別の件数。連投・連続削除の検知に使う。 */
export async function countRecentUserEvents(
  prisma: PrismaClient,
  input: CountRecentUserEventsInput,
): Promise<number> {
  return prisma.memberActivityEvent.count({
    where: {
      guildId: input.guildId,
      userId: input.userId,
      event: input.event,
      occurredAt: { gte: input.since },
    },
  });
}

export interface MemberActivityEventRecord {
  id: string;
  userId: string | null;
  event: MemberActivityEventType;
  channelId: string | null;
  messageId: string | null;
  content: string | null;
  contentScrubbedAt: Date | null;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface ListMemberActivityEventsInput {
  guildId: string;
  userId?: string;
  event?: MemberActivityEventType;
  limit: number;
}

export async function listMemberActivityEvents(
  prisma: PrismaClient,
  input: ListMemberActivityEventsInput,
): Promise<MemberActivityEventRecord[]> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit)));
  const rows = await prisma.memberActivityEvent.findMany({
    where: {
      guildId: input.guildId,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.event ? { event: input.event } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    event: row.event as MemberActivityEventType,
    channelId: row.channelId,
    messageId: row.messageId,
    content: row.content,
    contentScrubbedAt: row.contentScrubbedAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    occurredAt: row.occurredAt,
  }));
}
