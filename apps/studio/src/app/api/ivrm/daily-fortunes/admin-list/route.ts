import { prisma } from '@/lib/db';
import {
  authorizeFortuneAdminList,
} from '@/lib/daily-fortune-admin-list';
import { publicFortuneHistoryResult } from '@/lib/daily-fortune-read';

export const dynamic = 'force-dynamic';

/** Guild-scoped, read-only snapshots. Never return full stored profile JSON. */
export async function POST(request: Request): Promise<Response> {
  const input = await authorizeFortuneAdminList(request);
  if (input instanceof Response) return input;

  const reply = (body: unknown, status = 200): Response =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    });

  try {
    const rows = await prisma.dailyFortuneResult.findMany({
      where: {
        guildId: input.guildId,
        targetDate: { gte: input.from, lte: input.to },
        createdAt: { gte: new Date(Date.now() - 180 * 86400000) },
        ...(input.discordUserIds
          ? { discordUserId: { in: input.discordUserIds } }
          : {}),
      },
      orderBy: [
        { targetDate: 'desc' },
        { createdAt: 'desc' },
        { discordUserId: 'asc' },
      ],
      take: input.limit + 1,
      skip: input.offset,
      select: {
        discordUserId: true,
        targetDate: true,
        algorithmVersion: true,
        resultJson: true,
        createdAt: true,
      },
    });

    return reply({
      status: 'ok',
      guildId: input.guildId,
      items: rows.slice(0, input.limit).map((row) => ({
        discordUserId: row.discordUserId,
        date: row.targetDate,
        algorithmVersion: row.algorithmVersion,
        createdAt: row.createdAt,
        result: publicFortuneHistoryResult(row.resultJson),
      })),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        hasNext: rows.length > input.limit,
      },
    });
  } catch {
    return reply({ error: 'fortune_admin_list_unavailable' }, 503);
  }
}
