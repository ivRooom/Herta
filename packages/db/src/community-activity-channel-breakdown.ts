import type { PrismaClient } from '@prisma/client';

export interface CommunityActivityChannelBreakdownEntry {
  channelId: string;
  value: number;
}

/**
 * 選択期間[start, end]内で、指定metricの合計値が多いchannelを降順で返す。
 * community_activity_channel_dailyは実際にactivityがあったchannelだけ行を
 * 持つ(sparse)ため、大規模guildでも取得コストは実活動量に比例する。
 */
export async function getCommunityChannelBreakdown(
  prisma: PrismaClient,
  input: { guildId: string; metric: string; start: Date; end: Date; limit?: number },
): Promise<CommunityActivityChannelBreakdownEntry[]> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 10)));
  const rows = await prisma.communityActivityChannelDaily.groupBy({
    by: ['channelId'],
    where: {
      guildId: input.guildId,
      metric: input.metric,
      activityDate: { gte: input.start, lte: input.end },
    },
    _sum: { value: true },
    orderBy: [{ _sum: { value: 'desc' } }, { channelId: 'asc' }],
    take: limit,
  });
  return rows.map((row) => ({
    channelId: row.channelId,
    value: Number(row._sum.value ?? 0n),
  }));
}
