import type { PrismaClient } from '@herta/db';

export const COMMUNITY_ACTIVITY_METRICS = [
  'messages',
  'reactions_given',
  'reactions_received',
  'voice_seconds',
  'minecraft_seconds',
] as const;

export type CommunityActivityMetric = (typeof COMMUNITY_ACTIVITY_METRICS)[number];
export type CommunityActivityPeriod = 'today' | '7d' | '30d' | 'all';

export interface CommunityLeaderboardEntry {
  userId: string;
  total: number;
}

export interface CommunityUserRank {
  rank: number | null;
  total: number;
  participants: number;
}

export interface CommunityActivityTotals {
  messages: number;
  reactionsGiven: number;
  reactionsReceived: number;
  voiceSeconds: number;
  minecraftSeconds: number;
}

function jstDate(value = new Date()): Date {
  const key = new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

export function periodStart(period: CommunityActivityPeriod, now = new Date()): Date {
  const today = jstDate(now);
  if (period === 'today') return today;
  if (period === 'all') return new Date('1970-01-01T00:00:00.000Z');
  const days = period === '7d' ? 6 : 29;
  return new Date(today.getTime() - days * 86_400_000);
}

export async function incrementCommunityActivity(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: CommunityActivityMetric,
  amount = 1,
  occurredAt = new Date(),
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const activityDate = jstDate(occurredAt);
  await prisma.communityActivityDaily.upsert({
    where: {
      guildId_userId_activityDate_metric: { guildId, userId, activityDate, metric },
    },
    create: { guildId, userId, activityDate, metric, value: BigInt(Math.floor(amount)) },
    update: { value: { increment: BigInt(Math.floor(amount)) } },
  });
}

export async function getCommunityLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  metric: CommunityActivityMetric,
  period: CommunityActivityPeriod,
  limit = 10,
): Promise<CommunityLeaderboardEntry[]> {
  const rows = await prisma.communityActivityDaily.groupBy({
    by: ['userId'],
    where: { guildId, metric, activityDate: { gte: periodStart(period) } },
    _sum: { value: true },
    orderBy: { _sum: { value: 'desc' } },
    take: Math.max(1, Math.min(25, limit)),
  });
  return rows.map((row) => ({ userId: row.userId, total: Number(row._sum.value ?? 0n) }));
}

// /rank向けに対象期間の全参加者を同じ集計条件で並べ、本人の現在順位を返す。
export async function getCommunityUserRank(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: CommunityActivityMetric,
  period: CommunityActivityPeriod,
): Promise<CommunityUserRank> {
  const rows = await prisma.communityActivityDaily.groupBy({
    by: ['userId'],
    where: { guildId, metric, activityDate: { gte: periodStart(period) } },
    _sum: { value: true },
    orderBy: { _sum: { value: 'desc' } },
  });

  const index = rows.findIndex((row) => row.userId === userId);
  return {
    rank: index >= 0 ? index + 1 : null,
    total: index >= 0 ? Number(rows[index]?._sum.value ?? 0n) : 0,
    participants: rows.length,
  };
}

export async function getCommunityActivityTotals(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  period: CommunityActivityPeriod,
): Promise<CommunityActivityTotals> {
  const rows = await prisma.communityActivityDaily.groupBy({
    by: ['metric'],
    where: { guildId, userId, activityDate: { gte: periodStart(period) } },
    _sum: { value: true },
  });
  const totals = new Map(rows.map((row) => [row.metric, Number(row._sum.value ?? 0n)]));
  return {
    messages: totals.get('messages') ?? 0,
    reactionsGiven: totals.get('reactions_given') ?? 0,
    reactionsReceived: totals.get('reactions_received') ?? 0,
    voiceSeconds: totals.get('voice_seconds') ?? 0,
    minecraftSeconds: totals.get('minecraft_seconds') ?? 0,
  };
}

export async function startVoiceSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  channelId: string,
  startedAt = new Date(),
): Promise<void> {
  await prisma.communityVoiceSession.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, channelId, startedAt },
    update: { channelId, startedAt },
  });
}

function voiceChunks(start: Date, end: Date): Array<{ date: Date; seconds: number }> {
  const chunks: Array<{ date: Date; seconds: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const local = new Date(cursor.getTime() + 9 * 60 * 60 * 1000);
    const nextMidnightUtc =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) -
      9 * 60 * 60 * 1000;
    const chunkEnd = new Date(Math.min(end.getTime(), nextMidnightUtc));
    const seconds = Math.max(0, Math.floor((chunkEnd.getTime() - cursor.getTime()) / 1000));
    if (seconds > 0) chunks.push({ date: jstDate(cursor), seconds });
    cursor = chunkEnd;
  }
  return chunks;
}

export async function finishVoiceSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  endedAt = new Date(),
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.communityVoiceSession.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!session) return 0;

    await tx.communityVoiceSession.delete({
      where: { guildId_userId: { guildId, userId } },
    });

    let total = 0;
    for (const chunk of voiceChunks(session.startedAt, endedAt)) {
      total += chunk.seconds;
      await tx.communityActivityDaily.upsert({
        where: {
          guildId_userId_activityDate_metric: {
            guildId,
            userId,
            activityDate: chunk.date,
            metric: 'voice_seconds',
          },
        },
        create: {
          guildId,
          userId,
          activityDate: chunk.date,
          metric: 'voice_seconds',
          value: BigInt(chunk.seconds),
        },
        update: { value: { increment: BigInt(chunk.seconds) } },
      });
    }
    return total;
  });
}

export async function resetVoiceSessions(prisma: PrismaClient, guildId: string): Promise<void> {
  await prisma.communityVoiceSession.deleteMany({ where: { guildId } });
}
