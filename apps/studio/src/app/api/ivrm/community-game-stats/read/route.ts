import { prisma } from '@/lib/db';
import {
  authorizeCommunityGameStatsRead,
  buildCommunityMatrix,
  buildCommunityMomentum,
  buildCommunityWeekdaySeconds,
  COMMUNITY_GAME_STATS_GAMES_LIMIT,
  COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT,
  formatCommunityGameEarliestDate,
  projectCommunityActivityMessageRankingRow,
  projectCommunityActivityTotals,
  projectCommunityActivityUserTotals,
  projectCommunityActivityVoiceRankingRow,
  projectCommunityGameDailyPointRow,
  projectCommunityGameDetailRow,
  projectCommunityGamePlayerRow,
  projectCommunityGameRankingRow,
  projectCommunityGameStatRow,
  projectCommunityInsightsTotalsRow,
  projectCommunityMatrixCellRow,
  projectCommunityMatrixMemberRow,
  projectCommunityMomentumNewPlayersRow,
  projectCommunityMomentumRecentRow,
  projectCommunityTopGameRow,
  projectCommunityUserGameRow,
  projectCommunityWeekdaySecondsRow,
  summarizeCommunityPlayDates,
  toCommunityGameDateString,
  toCommunityGameSeconds,
  type CommunityActivityMessageRankingItem,
  type CommunityActivityTotals,
  type CommunityActivityUserTotals,
  type CommunityActivityVoiceRankingItem,
  type CommunityGameDetail,
  type CommunityGameStatsInput,
  type CommunityGameViewer,
  type CommunityInsightsOverview,
  type CommunityInsightsUser,
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
/**
 * v3 overview insights (S5, #1041): period totals, the
 * member × game matrix over the period's top 15 games, the
 * Monday-first weekday distribution, and per-game momentum
 * (trailing-7-day seconds plus players whose first observed
 * play of the game falls inside the period). Same fail-soft
 * and casting rules as the activity section.
 */
async function readOverviewInsights(
  input: CommunityGameStatsInput,
): Promise<CommunityInsightsOverview | null> {
  try {
    const totalsRows = await prisma.$queryRaw<
      Array<{ totalSeconds: bigint; playerCount: number }>
    >`SELECT SUM(value)::bigint AS "totalSeconds",
        COUNT(DISTINCT user_id)::int AS "playerCount"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
    const topGameRows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT activity_name AS name
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY activity_name
      ORDER BY SUM(value) DESC, activity_name ASC
      LIMIT ${COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT}`;
    const games = topGameRows.map((row) => projectCommunityTopGameRow(row));
    const memberRows = await prisma.$queryRaw<Array<{ discordUserId: string }>>`
      SELECT user_id AS "discordUserId"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id
      ORDER BY SUM(value) DESC, user_id ASC`;
    const cellRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; name: string; totalSeconds: bigint }>
    >`WITH top_games AS (
        SELECT activity_name FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name
        ORDER BY SUM(value) DESC, activity_name ASC
        LIMIT ${COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT})
      SELECT daily.user_id AS "discordUserId", daily.activity_name AS name,
        SUM(daily.value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily daily
      JOIN top_games ON top_games.activity_name = daily.activity_name
      WHERE daily.guild_id = ${input.guildId}
        AND daily.activity_date >= ${input.from}::date
        AND daily.activity_date <= ${input.to}::date
      GROUP BY daily.user_id, daily.activity_name`;
    const weekdayRows = await prisma.$queryRaw<
      Array<{ isoDow: number; totalSeconds: bigint }>
    >`SELECT EXTRACT(ISODOW FROM activity_date)::int AS "isoDow",
        SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY EXTRACT(ISODOW FROM activity_date)`;
    const recentRows = await prisma.$queryRaw<
      Array<{ name: string; recentSeconds: bigint }>
    >`WITH top_games AS (
        SELECT activity_name FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name
        ORDER BY SUM(value) DESC, activity_name ASC
        LIMIT ${COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT})
      SELECT top_games.activity_name AS name,
        COALESCE(SUM(daily.value), 0)::bigint AS "recentSeconds"
      FROM top_games
      LEFT JOIN community_game_activity_daily daily
        ON daily.guild_id = ${input.guildId}
        AND daily.activity_name = top_games.activity_name
        AND daily.activity_date >= ${input.from}::date
        AND daily.activity_date >= ${input.to}::date - 6
        AND daily.activity_date <= ${input.to}::date
      GROUP BY top_games.activity_name`;
    const newPlayerRows = await prisma.$queryRaw<
      Array<{ name: string; newPlayerCount: number }>
    >`WITH top_games AS (
        SELECT activity_name FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name
        ORDER BY SUM(value) DESC, activity_name ASC
        LIMIT ${COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT}),
      first_plays AS (
        SELECT user_id, activity_name, MIN(activity_date) AS first_date
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND activity_date <= ${input.to}::date
        GROUP BY user_id, activity_name)
      SELECT top_games.activity_name AS name,
        COUNT(first_plays.user_id)::int AS "newPlayerCount"
      FROM top_games
      LEFT JOIN first_plays
        ON first_plays.activity_name = top_games.activity_name
        AND first_plays.first_date >= ${input.from}::date
        AND first_plays.first_date <= ${input.to}::date
      GROUP BY top_games.activity_name`;
    return {
      totals: projectCommunityInsightsTotalsRow(
        totalsRows[0] ?? { totalSeconds: 0n, playerCount: 0 },
      ),
      matrix: {
        games,
        members: buildCommunityMatrix(
          games,
          memberRows.map((row) => projectCommunityMatrixMemberRow(row)),
          cellRows.map((row) => projectCommunityMatrixCellRow(row)),
        ),
      },
      weekdaySeconds: buildCommunityWeekdaySeconds(
        weekdayRows.map((row) => projectCommunityWeekdaySecondsRow(row)),
      ),
      momentum: buildCommunityMomentum(
        games,
        recentRows.map((row) => projectCommunityMomentumRecentRow(row)),
        newPlayerRows.map((row) => projectCommunityMomentumNewPlayersRow(row)),
      ),
    };
  } catch (error) {
    console.error('community_game_insights_read_failed', error);
    return null;
  }
}
/**
 * v3 user insights (S5, #1041): play days inside the period,
 * streaks over the whole observed history up to the range
 * end (never ranked — V3), the daily series inside the
 * period, and the user's weekday distribution.
 */
async function readUserInsights(
  input: CommunityGameStatsInput,
): Promise<CommunityInsightsUser | null> {
  try {
    const userId = input.discordUserId as string;
    const dailyRows = await prisma.$queryRaw<
      Array<{ date: Date | string; totalSeconds: bigint }>
    >`SELECT activity_date AS date, SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId} AND user_id = ${userId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY activity_date
      ORDER BY activity_date ASC`;
    const dateRows = await prisma.$queryRaw<Array<{ date: Date | string }>>`
      SELECT DISTINCT activity_date AS date
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId} AND user_id = ${userId}
        AND activity_date <= ${input.to}::date
      ORDER BY activity_date ASC`;
    const weekdayRows = await prisma.$queryRaw<
      Array<{ isoDow: number; totalSeconds: bigint }>
    >`SELECT EXTRACT(ISODOW FROM activity_date)::int AS "isoDow",
        SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId} AND user_id = ${userId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY EXTRACT(ISODOW FROM activity_date)`;
    const dailySeries = dailyRows.map((row) => projectCommunityGameDailyPointRow(row));
    return {
      playDays: dailySeries.length,
      ...summarizeCommunityPlayDates(dateRows.map((row) => toCommunityGameDateString(row.date))),
      dailySeries,
      weekdaySeconds: buildCommunityWeekdaySeconds(
        weekdayRows.map((row) => projectCommunityWeekdaySecondsRow(row)),
      ),
    };
  } catch (error) {
    console.error('community_game_insights_read_failed', error);
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
    if (input.mode === 'game') {
      // v3 game mode (S5, #1041): one game's totals and first /
      // last observed play inside the period, every player's
      // share paginated like the rankings, and the optional
      // viewer's rank (competition ranking over all players;
      // the relay recomputes it after opt-out filtering).
      // Unlike the insights sections this is the response's
      // main content, so a read failure is a 503, not a null.
      const gameName = input.gameName as string;
      const detailRows = await prisma.$queryRaw<
        Array<{
          name: string;
          totalSeconds: bigint;
          playerCount: number;
          firstPlayDate: Date | string | null;
          lastPlayDate: Date | string | null;
        }>
      >`SELECT activity_name AS name, SUM(value)::bigint AS "totalSeconds",
          COUNT(DISTINCT user_id)::int AS "playerCount",
          MIN(activity_date) AS "firstPlayDate", MAX(activity_date) AS "lastPlayDate"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND activity_name = ${gameName}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY activity_name`;
      const detail: CommunityGameDetail = detailRows[0]
        ? projectCommunityGameDetailRow(detailRows[0])
        : {
            name: gameName,
            totalSeconds: 0,
            playerCount: 0,
            firstPlayDate: null,
            lastPlayDate: null,
          };
      const playerRows = await prisma.$queryRaw<
        Array<{ discordUserId: string; totalSeconds: bigint }>
      >`SELECT user_id AS "discordUserId", SUM(value)::bigint AS "totalSeconds"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND activity_name = ${gameName}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id
        ORDER BY SUM(value) DESC, user_id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}`;
      const playerCounts = await prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS total FROM (
          SELECT user_id FROM community_game_activity_daily
          WHERE guild_id = ${input.guildId} AND activity_name = ${gameName}
            AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
          GROUP BY user_id) ranked_users`;
      const playerTotal = playerCounts[0]?.total ?? 0;
      let viewer: CommunityGameViewer | null = null;
      if (input.discordUserId !== null) {
        const viewerRows = await prisma.$queryRaw<Array<{ totalSeconds: bigint | null }>>`
          SELECT SUM(value)::bigint AS "totalSeconds" FROM community_game_activity_daily
          WHERE guild_id = ${input.guildId} AND activity_name = ${gameName}
            AND user_id = ${input.discordUserId}
            AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
        const viewerSeconds = toCommunityGameSeconds(viewerRows[0]?.totalSeconds ?? 0n);
        let rank: number | null = null;
        if (viewerSeconds > 0) {
          const aheadRows = await prisma.$queryRaw<Array<{ ahead: number }>>`
            SELECT COUNT(*)::int AS ahead FROM (
              SELECT user_id FROM community_game_activity_daily
              WHERE guild_id = ${input.guildId} AND activity_name = ${gameName}
                AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
              GROUP BY user_id
              HAVING SUM(value) > ${BigInt(viewerSeconds)}) ahead_players`;
          rank = (aheadRows[0]?.ahead ?? 0) + 1;
        }
        viewer = { discordUserId: input.discordUserId, rank, totalSeconds: viewerSeconds };
      }
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'game',
        range,
        meta,
        game: detail,
        players: {
          items: playerRows.map((row) => projectCommunityGamePlayerRow(row)),
          pagination: {
            limit: input.limit,
            offset: input.offset,
            total: playerTotal,
            hasNext: input.offset + playerRows.length < playerTotal,
          },
        },
        viewer,
      });
    }
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
        ...(input.version >= 2 ? { activity: await readUserActivity(input) } : {}),
        ...(input.version === 3 ? { insights: await readUserInsights(input) } : {}),
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
      ...(input.version >= 2 ? { activity: await readOverviewActivity(input) } : {}),
      ...(input.version === 3 ? { insights: await readOverviewInsights(input) } : {}),
    });
  } catch (error) {
    console.error('community_game_stats_read_failed', error);
    return reply({ error: 'community_game_stats_unavailable' }, 503);
  }
}
