import type { PrismaClient } from '@prisma/client';

export interface CommunityGameBreakdownEntry {
  activityName: string;
  value: number;
}

/**
 * 選択期間[start, end]内で、プレイ時間合計が多いゲーム/アプリを降順で返す。
 * community_game_activity_dailyは実際にplayされたactivityだけ行を持つ(sparse)。
 */
export async function getCommunityGameBreakdown(
  prisma: PrismaClient,
  input: { guildId: string; start: Date; end: Date; limit?: number },
): Promise<CommunityGameBreakdownEntry[]> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 10)));
  const rows = await prisma.communityGameActivityDaily.groupBy({
    by: ['activityName'],
    where: {
      guildId: input.guildId,
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
