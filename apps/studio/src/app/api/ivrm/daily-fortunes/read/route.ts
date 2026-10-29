import { prisma } from '@/lib/db';
import { authorizeDailyFortuneRead, publicFortuneHistoryResult } from '@/lib/daily-fortune-read';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const input = await authorizeDailyFortuneRead(request);
  if (input instanceof Response) return input;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const rows = await prisma.$queryRaw<
      Array<{ date: string; algorithmVersion: string; result: unknown; createdAt: Date }>
    >`SELECT target_date AS date,algorithm_version AS "algorithmVersion",result_json AS result,created_at AS "createdAt" FROM daily_fortune_results WHERE guild_id=${input.guildId} AND discord_user_id=${input.discordUserId} AND target_date>=${input.from} AND target_date<=${input.to} AND created_at>NOW()-INTERVAL '180 days' ORDER BY target_date DESC LIMIT ${input.limit} OFFSET ${input.offset}`;
    const counts = await prisma.$queryRaw<
      Array<{ total: number }>
    >`SELECT COUNT(*)::int AS total FROM daily_fortune_results WHERE guild_id=${input.guildId} AND discord_user_id=${input.discordUserId} AND target_date>=${input.from} AND target_date<=${input.to} AND created_at>NOW()-INTERVAL '180 days'`;
    const total = counts[0]?.total ?? 0;
    return reply({
      status: 'ok',
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      items: rows.map((row) => ({ ...row, result: publicFortuneHistoryResult(row.result) })),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total,
        hasNext: input.offset + rows.length < total,
      },
    });
  } catch {
    return reply({ error: 'fortune_history_unavailable' }, 503);
  }
}
