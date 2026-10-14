import type { PrismaClient } from '@prisma/client';

export interface CommunityUserMetricTotal {
  metric: string;
  value: number;
}

export interface CommunityUserDailyPoint {
  activityDate: Date;
  value: number;
}

/**
 * 指定期間内の、指定userの全metric合計値を返す(community_activity_dailyをmetric別に
 * groupBy)。guild全体のメトリクス合計(page.tsxの既存totalsクエリ)と同じ形で、
 * userId絞り込みを加えただけ。
 */
export async function getCommunityUserMetricTotals(
  prisma: PrismaClient,
  input: { guildId: string; userId: string; start: Date; end: Date },
): Promise<CommunityUserMetricTotal[]> {
  const rows = await prisma.communityActivityDaily.groupBy({
    by: ['metric'],
    where: {
      guildId: input.guildId,
      userId: input.userId,
      activityDate: { gte: input.start, lte: input.end },
    },
    _sum: { value: true },
  });
  return rows.map((row) => ({
    metric: row.metric,
    value: Number(row._sum.value ?? 0n),
  }));
}

/**
 * 指定期間内の、指定user・指定metricの日次時系列を返す(community_activity_dailyを
 * activityDate別にgroupBy)。page.tsxの既存dailyRowsクエリと同じ形で、userId絞り込みを
 * 加えただけ。
 */
export async function getCommunityUserDailySeries(
  prisma: PrismaClient,
  input: { guildId: string; userId: string; metric: string; start: Date; end: Date },
): Promise<CommunityUserDailyPoint[]> {
  const rows = await prisma.communityActivityDaily.groupBy({
    by: ['activityDate'],
    where: {
      guildId: input.guildId,
      userId: input.userId,
      metric: input.metric,
      activityDate: { gte: input.start, lte: input.end },
    },
    _sum: { value: true },
    orderBy: { activityDate: 'asc' },
  });
  return rows.map((row) => ({
    activityDate: row.activityDate,
    value: Number(row._sum.value ?? 0n),
  }));
}
