import type { PrismaClient } from '@prisma/client';

export interface CommunityUserGameBreakdownEntry {
  activityName: string;
  value: number;
}

/**
 * 指定user・指定期間のプレイ時間合計が多いゲーム/アプリを降順で返す。
 * getCommunityGameBreakdown(community-game-breakdown.ts)と同じ実装に、userId絞り込みを
 * 加えただけ。
 */
export async function getCommunityUserGameBreakdown(
  prisma: PrismaClient,
  input: { guildId: string; userId: string; start: Date; end: Date; limit?: number },
): Promise<CommunityUserGameBreakdownEntry[]> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 10)));
  const rows = await prisma.communityGameActivityDaily.groupBy({
    by: ['activityName'],
    where: {
      guildId: input.guildId,
      userId: input.userId,
      activityDate: { gte: input.start, lte: input.end },
    },
    _sum: { value: true },
    orderBy: [{ _sum: { value: 'desc' } }, { activityName: 'asc' }],
    take: limit,
  });
  return rows.map((row) => ({
    activityName: row.activityName,
    value: Number(row._sum.value ?? 0n),
  }));
}
