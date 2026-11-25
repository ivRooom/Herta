import { prisma } from '@/lib/db';
import {
  authorizeCommunityGameStatsRead,
  COMMUNITY_GAME_STATS_GAMES_LIMIT,
  formatCommunityGameEarliestDate,
  projectCommunityGameRankingRow,
  projectCommunityGameStatRow,
  projectCommunityUserGameRow,
  toCommunityGameSeconds,
} from '@/lib/community-game-stats';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const input = await authorizeCommunityGameStatsRead(request);
  if (input instanceof Response) return input;
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const earliestRows = await prisma.$queryRaw<Array<{ earliestDate: Date | string | null }>>`
      SELECT MIN(activity_date) AS "earliestDate" FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}`;
    const meta = { earliestDate: formatCommunityGameEarliestDate(earliestRows[0]?.earliestDate) };
    const range = { from: input.from, to: input.to };
    if (input.mode === 'user') {
      const userId = input.discordUserId as string;
      const rows = await prisma.$queryRaw<
        Array<{ name: string; totalSeconds: bigint }>
      >`SELECT activity_name AS name, SUM(value) AS "totalSeconds"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND user_id = ${userId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name
        ORDER BY SUM(value) DESC, activity_name ASC
        LIMIT ${COMMUNITY_GAME_STATS_GAMES_LIMIT}`;
      const totals = await prisma.$queryRaw<Array<{ totalSeconds: bigint | null }>>`
        SELECT SUM(value) AS "totalSeconds" FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND user_id = ${userId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'user',
        range,
        meta,
        user: {
          discordUserId: userId,
          totalSeconds: toCommunityGameSeconds(totals[0]?.totalSeconds ?? 0n),
          games: rows.map((row) => projectCommunityUserGameRow(row)),
        },
      });
    }
    const gameRows = await prisma.$queryRaw<
      Array<{ name: string; totalSeconds: bigint; playerCount: number }>
    >`SELECT activity_name AS name, SUM(value) AS "totalSeconds",
        COUNT(DISTINCT user_id)::int AS "playerCount"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY activity_name
      ORDER BY SUM(value) DESC, activity_name ASC
      LIMIT ${COMMUNITY_GAME_STATS_GAMES_LIMIT}`;
    const rankingRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; totalSeconds: bigint; topGameName: string }>
    >`SELECT totals.user_id AS "discordUserId", totals.total AS "totalSeconds",
        (SELECT inner_rows.activity_name FROM community_game_activity_daily inner_rows
          WHERE inner_rows.guild_id = ${input.guildId}
            AND inner_rows.user_id = totals.user_id
            AND inner_rows.activity_date >= ${input.from}::date
            AND inner_rows.activity_date <= ${input.to}::date
          GROUP BY inner_rows.activity_name
          ORDER BY SUM(inner_rows.value) DESC, inner_rows.activity_name ASC
          LIMIT 1) AS "topGameName"
      FROM (SELECT user_id, SUM(value) AS total FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) totals
      ORDER BY totals.total DESC, totals.user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`;
    const counts = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT user_id FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) ranked_users`;
    const total = counts[0]?.total ?? 0;
    return reply({
      status: 'ok',
      guildId: input.guildId,
      mode: 'overview',
      range,
      meta,
      games: gameRows.map((row) => projectCommunityGameStatRow(row)),
      ranking: {
        items: rankingRows.map((row) => projectCommunityGameRankingRow(row)),
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total,
          hasNext: input.offset + rankingRows.length < total,
        },
      },
    });
  } catch {
    return reply({ error: 'community_game_stats_unavailable' }, 503);
  }
}
