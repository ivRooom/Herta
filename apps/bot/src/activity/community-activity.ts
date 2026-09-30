import type { PrismaClient } from '@herta/db';

export const COMMUNITY_ACTIVITY_METRICS = [
  'messages',
  'reactions_given',
  'reactions_received',
  'voice_seconds',
  'minecraft_seconds',
  'online_seconds',
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
  onlineSeconds: number;
}

interface CommunityUserRankRow {
  rank: bigint | null;
  total: bigint;
  participants: bigint;
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
  channelId?: string,
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
  if (channelId) {
    await incrementCommunityChannelActivity(
      prisma,
      guildId,
      channelId,
      userId,
      metric,
      amount,
      activityDate,
    );
  }
}

/**
 * community_activity_dailyと同じ集計を、channel単位の内訳として別テーブルへも
 * 記録する。実際にactivityがあったguild/channel/user/日/metricの組だけ行を
 * 持つ(sparse)。既存のcommunity_activity_dailyクエリ・集計へは影響しない。
 */
async function incrementCommunityChannelActivity(
  prisma: PrismaClient,
  guildId: string,
  channelId: string,
  userId: string,
  metric: CommunityActivityMetric,
  amount: number,
  activityDate: Date,
): Promise<void> {
  await prisma.communityActivityChannelDaily.upsert({
    where: {
      guildId_channelId_userId_activityDate_metric: {
        guildId,
        channelId,
        userId,
        activityDate,
        metric,
      },
    },
    create: {
      guildId,
      channelId,
      userId,
      activityDate,
      metric,
      value: BigInt(Math.floor(amount)),
    },
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
    orderBy: [{ _sum: { value: 'desc' } }, { userId: 'asc' }],
    take: Math.max(1, Math.min(25, limit)),
  });
  return rows.map((row) => ({ userId: row.userId, total: Number(row._sum.value ?? 0n) }));
}

export async function getCommunityUserRank(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: CommunityActivityMetric,
  period: CommunityActivityPeriod,
): Promise<CommunityUserRank> {
  const start = periodStart(period);
  const rows = await prisma.$queryRaw<CommunityUserRankRow[]>`
    WITH totals AS (
      SELECT user_id, SUM(value)::bigint AS total
      FROM community_activity_daily
      WHERE guild_id = ${guildId}
        AND metric = ${metric}
        AND activity_date >= ${start}
      GROUP BY user_id
    ), ranked AS (
      SELECT
        user_id,
        total,
        ROW_NUMBER() OVER (ORDER BY total DESC, user_id ASC)::bigint AS rank
      FROM totals
    )
    SELECT
      ranked.rank,
      COALESCE(ranked.total, 0)::bigint AS total,
      (SELECT COUNT(*)::bigint FROM totals) AS participants
    FROM (VALUES (1)) AS seed(value)
    LEFT JOIN ranked ON ranked.user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return { rank: null, total: 0, participants: 0 };
  return {
    rank: row.rank === null ? null : Number(row.rank),
    total: Number(row.total),
    participants: Number(row.participants),
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
    onlineSeconds: totals.get('online_seconds') ?? 0,
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
      await tx.communityActivityChannelDaily.upsert({
        where: {
          guildId_channelId_userId_activityDate_metric: {
            guildId,
            channelId: session.channelId,
            userId,
            activityDate: chunk.date,
            metric: 'voice_seconds',
          },
        },
        create: {
          guildId,
          channelId: session.channelId,
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

/**
 * Discordのステータスがoffline以外になったタイミングで開始する「在席」セッション。
 * CommunityVoiceSessionと同じ設計で、PK(guildId, userId)のため同時に1本だけ持つ。
 */
export async function startPresenceSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  startedAt = new Date(),
): Promise<void> {
  await prisma.communityPresenceSession.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, startedAt },
    update: { startedAt },
  });
}

export async function finishPresenceSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  endedAt = new Date(),
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.communityPresenceSession.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!session) return 0;

    await tx.communityPresenceSession.delete({
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
            metric: 'online_seconds',
          },
        },
        create: {
          guildId,
          userId,
          activityDate: chunk.date,
          metric: 'online_seconds',
          value: BigInt(chunk.seconds),
        },
        update: { value: { increment: BigInt(chunk.seconds) } },
      });
    }
    return total;
  });
}

export async function resetPresenceSessions(prisma: PrismaClient, guildId: string): Promise<void> {
  await prisma.communityPresenceSession.deleteMany({ where: { guildId } });
}

/**
 * Discordプレゼンスの「プレイ中」アクティビティ(ゲーム・アプリ名)の
 * 開始セッション。activityNameが変わるたびに前のセッションを終了し
 * 新しいセッションを開始する(bot.ts側で切り替え判定を行う)。
 */
export async function startGameSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  activityName: string,
  startedAt = new Date(),
): Promise<void> {
  const normalizedName = activityName.trim().slice(0, 128);
  if (!normalizedName) return;
  await prisma.communityGameSession.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, activityName: normalizedName, startedAt },
    update: { activityName: normalizedName, startedAt },
  });
}

export async function finishGameSession(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  endedAt = new Date(),
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.communityGameSession.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!session) return 0;

    await tx.communityGameSession.delete({
      where: { guildId_userId: { guildId, userId } },
    });

    let total = 0;
    for (const chunk of voiceChunks(session.startedAt, endedAt)) {
      total += chunk.seconds;
      await tx.communityGameActivityDaily.upsert({
        where: {
          guildId_userId_activityName_activityDate: {
            guildId,
            userId,
            activityName: session.activityName,
            activityDate: chunk.date,
          },
        },
        create: {
          guildId,
          userId,
          activityName: session.activityName,
          activityDate: chunk.date,
          value: BigInt(chunk.seconds),
        },
        update: { value: { increment: BigInt(chunk.seconds) } },
      });
    }
    return total;
  });
}

export async function resetGameSessions(prisma: PrismaClient, guildId: string): Promise<void> {
  await prisma.communityGameSession.deleteMany({ where: { guildId } });
}
