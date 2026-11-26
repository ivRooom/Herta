import { prisma } from '@/lib/db';
import {
  authorizeCommunityGameStatsRead,
  COMMUNITY_GAME_STATS_GAMES_LIMIT,
  formatCommunityGameEarliestDate,
  projectCommunityActivityMessageRankingRow,
  projectCommunityActivityTotals,
  projectCommunityActivityUserTotals,
  projectCommunityActivityVoiceRankingRow,
  projectCommunityGameRankingRow,
  projectCommunityGameStatRow,
  projectCommunityUserGameRow,
  toCommunityGameSeconds,
  type CommunityActivityMessageRankingItem,
  type CommunityActivityTotals,
  type CommunityActivityUserTotals,
  type CommunityActivityVoiceRankingItem,
  type CommunityGameStatsInput,
} from '@/lib/community-game-stats';
export const dynamic = 'force-dynamic';
interface ActivityPagination {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}
interface CommunityActivityOverview {
  totals: CommunityActivityTotals;
  voiceRanking: { items: CommunityActivityVoiceRankingItem[]; pagination: ActivityPagination };
  messageRanking: { items: CommunityActivityMessageRankingItem[]; pagination: ActivityPagination };
}
/**
 * v2 activity section (S4b, #998): read from
 * community_activity_daily, the metric/value daily aggregate
 * the bot already maintains. Section-level fail-soft (U5):
 * an activity failure logs and degrades to null instead of
 * taking the game sections down with a 503. Every SUM over
 * the BigInt value column carries ::bigint — an uncast SUM
 * returns PG numeric, which Prisma hands back as a Decimal
 * the projections reject (#1004) — and every range bound
 * carries ::date (#999).
 */
async function readOverviewActivity(
  input: CommunityGameStatsInput,
): Promise<CommunityActivityOverview | null> {
  try {
    const totalsRows = await prisma.$queryRaw<
      Array<{ metric: string; total: bigint; memberCount: number }>
    >`SELECT metric, SUM(value)::bigint AS total,
        COUNT(DISTINCT user_id)::int AS "memberCount"
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId}
        AND metric IN ('voice_seconds', 'messages', 'online_seconds')
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY metric`;
    const voiceRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; totalSeconds: bigint }>
    >`SELECT user_id AS "discordUserId", SUM(value)::bigint AS "totalSeconds"
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND metric = 'voice_seconds'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id
      ORDER BY SUM(value) DESC, user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`;
    const voiceCounts = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT user_id FROM community_activity_daily
        WHERE guild_id = ${input.guildId} AND metric = 'voice_seconds'
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) ranked_users`;
    const messageRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; totalCount: bigint }>
    >`SELECT user_id AS "discordUserId", SUM(value)::bigint AS "totalCount"
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND metric = 'messages'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id
      ORDER BY SUM(value) DESC, user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`;
    const messageCounts = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT user_id FROM community_activity_daily
        WHERE guild_id = ${input.guildId} AND metric = 'messages'
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) ranked_users`;
    const voiceTotal = voiceCounts[0]?.total ?? 0;
    const messageTotal = messageCounts[0]?.total ?? 0;
    return {
      totals: projectCommunityActivityTotals(totalsRows),
      voiceRanking: {
        items: voiceRows.map((row) => projectCommunityActivityVoiceRankingRow(row)),
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total: voiceTotal,
          hasNext: input.offset + voiceRows.length < voiceTotal,
        },
      },
      messageRanking: {
        items: messageRows.map((row) => projectCommunityActivityMessageRankingRow(row)),
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total: messageTotal,
          hasNext: input.offset + messageRows.length < messageTotal,
        },
      },
    };
  } catch (error) {
    console.error('community_activity_read_failed', error);
    return null;
  }
}
async function readUserActivity(
  input: CommunityGameStatsInput,
): Promise<CommunityActivityUserTotals | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ metric: string; total: bigint }>>`
      SELECT metric, SUM(value)::bigint AS total
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND user_id = ${input.discordUserId}
        AND metric IN ('voice_seconds', 'messages', 'online_seconds')
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY metric`;
    return projectCommunityActivityUserTotals(rows);
  } catch (error) {
    console.error('community_activity_read_failed', error);
    return null;
  }
}
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
      >`SELECT activity_name AS name, SUM(value)::bigint AS "totalSeconds"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND user_id = ${userId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name
        ORDER BY SUM(value) DESC, activity_name ASC
        LIMIT ${COMMUNITY_GAME_STATS_GAMES_LIMIT}`;
      const totals = await prisma.$queryRaw<Array<{ totalSeconds: bigint | null }>>`
        SELECT SUM(value)::bigint AS "totalSeconds" FROM community_game_activity_daily
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
        ...(input.version === 2 ? { activity: await readUserActivity(input) } : {}),
      });
    }
    const gameRows = await prisma.$queryRaw<
      Array<{ name: string; totalSeconds: bigint; playerCount: number }>
    >`SELECT activity_name AS name, SUM(value)::bigint AS "totalSeconds",
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
      FROM (SELECT user_id, SUM(value)::bigint AS total FROM community_game_activity_daily
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
      ...(input.version === 2 ? { activity: await readOverviewActivity(input) } : {}),
    });
  } catch (error) {
    console.error('community_game_stats_read_failed', error);
    return reply({ error: 'community_game_stats_unavailable' }, 503);
  }
}
