import { prisma } from '@/lib/db';
import { getGuildConfigurationOptionsCached } from '@/lib/bot-guild-options';
import { normalizeActivityRulesConfig } from '@herta/shared';
import {
  aggregateCommunityGamesOverviewV5,
  authorizeCommunityGameStatsRead,
  buildCommunityLeaderboardGameCounts,
  buildCommunityLeaderboardGrowth,
  buildCommunityMatrix,
  buildCommunityMatrixV5,
  buildCommunityMomentum,
  buildCommunityMomentumV5,
  buildCommunityUserGamesV5,
  buildCommunityWeekdaySeconds,
  buildCommunityWeeklyChampions,
  communityGameGroupIdentity,
  communityGamePreviousRange,
  COMMUNITY_CHANNEL_BREAKDOWN_LIMIT,
  COMMUNITY_GAME_STATS_GAMES_LIMIT,
  COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT,
  findCommunityGameMappingByApplicationId,
  findCommunityGameMappingByName,
  formatCommunityGameEarliestDate,
  groupCommunityGameRows,
  projectCommunityActivityMessageRankingRow,
  projectCommunityActivityTotals,
  projectCommunityActivityUserTotals,
  projectCommunityActivityUserTotalsV4,
  projectCommunityActivityVoiceRankingRow,
  projectCommunityChannelMessageMemberRow,
  projectCommunityChannelMessageRow,
  projectCommunityChannelName,
  projectCommunityChannelVoiceMemberRow,
  projectCommunityChannelVoiceRow,
  projectCommunityCharUnitsRankingRow,
  projectCommunityCharUnitsTotalsRow,
  projectCommunityGameDailyPointRow,
  projectCommunityGameDetailRow,
  projectCommunityGameDetailSourceRow,
  projectCommunityGameFirstPlayRow,
  projectCommunityGamePlayerRow,
  projectCommunityGameRankingRow,
  projectCommunityGameSourceRow,
  projectCommunityGameStatRow,
  projectCommunityGameUserSourceRow,
  projectCommunityInsightsTotalsRow,
  projectCommunityLeaderboardGrowthRow,
  projectCommunityLeaderboardPlayDaysRow,
  projectCommunityMatrixCellRow,
  projectCommunityMatrixMemberRow,
  projectCommunityMomentumNewPlayersRow,
  projectCommunityMomentumRecentRow,
  projectCommunityTopGameRow,
  projectCommunityUserGameRow,
  projectCommunityWeekdaySecondsRow,
  projectCommunityWeeklyChampionRow,
  resolveCommunityGame,
  summarizeCommunityPlayDates,
  toCommunityGameDateString,
  toCommunityGameSeconds,
  type CommunityActivityMessageRankingItem,
  type CommunityActivityTotals,
  type CommunityActivityUserTotals,
  type CommunityActivityUserTotalsV4,
  type CommunityActivityVoiceRankingItem,
  type CommunityChannelMetric,
  type CommunityChannelsOverview,
  type CommunityGameDetail,
  type CommunityGameDetailV5,
  type CommunityGameIdentityMapping,
  type CommunityGameStatsInput,
  type CommunityGameViewer,
  type CommunityInsightsOverview,
  type CommunityInsightsOverviewV5,
  type CommunityInsightsUser,
  type CommunityLeaderboardsOverview,
  type CommunityUserGameItem,
  type CommunityUserGameItemV5,
  type CommunityWeeklyChampionsOverview,
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
 * v4 user activity (S6, #1054): the v2 read plus the user's
 * message_char_units total, projected by the separate v4
 * projection so the v2/v3 activity shape stays untouched.
 */
async function readUserActivityV4(
  input: CommunityGameStatsInput,
): Promise<CommunityActivityUserTotalsV4 | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ metric: string; total: bigint }>>`
      SELECT metric, SUM(value)::bigint AS total
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND user_id = ${input.discordUserId}
        AND metric IN ('voice_seconds', 'messages', 'online_seconds', 'message_char_units')
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY metric`;
    return projectCommunityActivityUserTotalsV4(rows);
  } catch (error) {
    console.error('community_activity_read_failed', error);
    return null;
  }
}
/**
 * v4 overview channels section (S6, #1054): the per-channel
 * breakdowns from community_activity_channel_daily (voice
 * stay and message counts, top 25 each) plus the
 * message_char_units totals and member ranking from
 * community_activity_daily. Same fail-soft and casting rules
 * as the other sections. Channel names are not stored in
 * the database: they are resolved from the bot's guild
 * options (the same source the Studio community dashboard
 * uses), and a channel that no longer resolves — deleted,
 * or the bot unreachable — keeps name: null rather than an
 * invented label.
 */
async function readOverviewChannels(
  input: CommunityGameStatsInput,
): Promise<CommunityChannelsOverview | null> {
  try {
    const recordedRows = await prisma.$queryRaw<Array<{ recordedFrom: Date | string | null }>>`
      SELECT MIN(activity_date) AS "recordedFrom" FROM community_activity_channel_daily
      WHERE guild_id = ${input.guildId}`;
    const voiceRows = await prisma.$queryRaw<
      Array<{ channelId: string; totalSeconds: bigint; memberCount: number }>
    >`SELECT channel_id AS "channelId", SUM(value)::bigint AS "totalSeconds",
        COUNT(DISTINCT user_id)::int AS "memberCount"
      FROM community_activity_channel_daily
      WHERE guild_id = ${input.guildId} AND metric = 'voice_seconds'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY channel_id
      ORDER BY SUM(value) DESC, channel_id ASC
      LIMIT ${COMMUNITY_CHANNEL_BREAKDOWN_LIMIT}`;
    const messageRows = await prisma.$queryRaw<
      Array<{ channelId: string; totalCount: bigint; memberCount: number }>
    >`SELECT channel_id AS "channelId", SUM(value)::bigint AS "totalCount",
        COUNT(DISTINCT user_id)::int AS "memberCount"
      FROM community_activity_channel_daily
      WHERE guild_id = ${input.guildId} AND metric = 'messages'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY channel_id
      ORDER BY SUM(value) DESC, channel_id ASC
      LIMIT ${COMMUNITY_CHANNEL_BREAKDOWN_LIMIT}`;
    const charTotalsRows = await prisma.$queryRaw<
      Array<{ totalUnits: bigint | null; memberCount: number }>
    >`SELECT SUM(value)::bigint AS "totalUnits",
        COUNT(DISTINCT user_id)::int AS "memberCount"
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND metric = 'message_char_units'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
    const charRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; totalUnits: bigint }>
    >`SELECT user_id AS "discordUserId", SUM(value)::bigint AS "totalUnits"
      FROM community_activity_daily
      WHERE guild_id = ${input.guildId} AND metric = 'message_char_units'
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id
      ORDER BY SUM(value) DESC, user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`;
    const charCounts = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT user_id FROM community_activity_daily
        WHERE guild_id = ${input.guildId} AND metric = 'message_char_units'
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) ranked_users`;
    const voice = voiceRows.map((row) => projectCommunityChannelVoiceRow(row));
    const messages = messageRows.map((row) => projectCommunityChannelMessageRow(row));
    let nameById = new Map<string, string>();
    if (voice.length + messages.length > 0) {
      try {
        const options = await getGuildConfigurationOptionsCached(input.guildId);
        nameById = new Map((options?.channels ?? []).map((channel) => [channel.id, channel.name]));
      } catch {
        // Names degrade to null; the section itself stands.
      }
    }
    const charTotal = charCounts[0]?.total ?? 0;
    return {
      recordedFrom: formatCommunityGameEarliestDate(recordedRows[0]?.recordedFrom),
      voiceChannels: voice.map((item) => ({
        ...item,
        name: projectCommunityChannelName(nameById.get(item.channelId)),
      })),
      messageChannels: messages.map((item) => ({
        ...item,
        name: projectCommunityChannelName(nameById.get(item.channelId)),
      })),
      charUnits: {
        ...projectCommunityCharUnitsTotalsRow({
          totalUnits: charTotalsRows[0]?.totalUnits ?? 0n,
          memberCount: charTotalsRows[0]?.memberCount ?? 0,
        }),
        ranking: {
          items: charRows.map((row) => projectCommunityCharUnitsRankingRow(row)),
          pagination: {
            limit: input.limit,
            offset: input.offset,
            total: charTotal,
            hasNext: input.offset + charRows.length < charTotal,
          },
        },
      },
    };
  } catch (error) {
    console.error('community_channels_read_failed', error);
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
/**
 * v5 game identity mappings (S7b, #1060): the guild's
 * Activity Rules config carries the canonical-name table
 * (W3), read through the same guild_plugins row and the
 * same normalization the bot applies, so supply and
 * collection can never disagree about the config shape.
 * A config read failure degrades to the code defaults
 * instead of failing the read: unification is an
 * enhancement of the game sections, and the id / name
 * grouping underneath stays correct without it.
 */
async function readGameIdentityMappings(guildId: string): Promise<CommunityGameIdentityMapping[]> {
  const toLibMappings = (
    config: ReturnType<typeof normalizeActivityRulesConfig>,
  ): CommunityGameIdentityMapping[] =>
    config.gameIdentityMappings.map((mapping) => ({
      canonicalName: mapping.canonicalName,
      applicationIds: [...mapping.applicationIds],
      activityNames: [...mapping.activityNames],
    }));
  try {
    const row = await prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'activity-rules' } },
      select: { config: true },
    });
    return toLibMappings(normalizeActivityRulesConfig(row?.config ?? {}));
  } catch (error) {
    console.error('community_game_identity_mapping_read_failed', error);
    return toLibMappings(normalizeActivityRulesConfig(undefined));
  }
}
/**
 * v5 overview insights (S7b, #1060): the v3 insights with
 * the game-bearing parts (matrix games / cells, momentum)
 * resolved through the unified identity. Totals and the
 * weekday distribution do not key on games and keep the
 * v3 queries. The per-user source rows drive both the
 * top-15 selection and the matrix cells, so the two can
 * never disagree about a game's membership or order.
 * Same fail-soft and casting rules as the other sections.
 */
async function readOverviewInsightsV5(
  input: CommunityGameStatsInput,
  mappings: CommunityGameIdentityMapping[],
): Promise<CommunityInsightsOverviewV5 | null> {
  try {
    const totalsRows = await prisma.$queryRaw<
      Array<{ totalSeconds: bigint; playerCount: number }>
    >`SELECT SUM(value)::bigint AS "totalSeconds",
        COUNT(DISTINCT user_id)::int AS "playerCount"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
    const userRows = await prisma.$queryRaw<
      Array<{
        discordUserId: string;
        name: string;
        applicationId: string;
        totalSeconds: bigint;
      }>
    >`SELECT user_id AS "discordUserId", activity_name AS name,
        application_id AS "applicationId", SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id, activity_name, application_id`;
    const sourceRows = userRows.map((row) => projectCommunityGameUserSourceRow(row));
    const topGames = groupCommunityGameRows(sourceRows, mappings)
      .slice(0, COMMUNITY_GAME_STATS_MATRIX_GAMES_LIMIT)
      .map((group) => communityGameGroupIdentity(group));
    const weekdayRows = await prisma.$queryRaw<
      Array<{ isoDow: number; totalSeconds: bigint }>
    >`SELECT EXTRACT(ISODOW FROM activity_date)::int AS "isoDow",
        SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY EXTRACT(ISODOW FROM activity_date)`;
    const recentRows = await prisma.$queryRaw<
      Array<{ name: string; applicationId: string; totalSeconds: bigint }>
    >`SELECT activity_name AS name, application_id AS "applicationId",
        SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date
        AND activity_date >= ${input.to}::date - 6
        AND activity_date <= ${input.to}::date
      GROUP BY activity_name, application_id`;
    const firstPlayRows = await prisma.$queryRaw<
      Array<{
        discordUserId: string;
        name: string;
        applicationId: string;
        firstDate: Date | string;
      }>
    >`SELECT user_id AS "discordUserId", activity_name AS name,
        application_id AS "applicationId", MIN(activity_date) AS "firstDate"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date <= ${input.to}::date
      GROUP BY user_id, activity_name, application_id`;
    return {
      totals: projectCommunityInsightsTotalsRow(
        totalsRows[0] ?? { totalSeconds: 0n, playerCount: 0 },
      ),
      matrix: {
        games: topGames,
        members: buildCommunityMatrixV5(topGames, sourceRows, mappings),
      },
      weekdaySeconds: buildCommunityWeekdaySeconds(
        weekdayRows.map((row) => projectCommunityWeekdaySecondsRow(row)),
      ),
      momentum: buildCommunityMomentumV5(
        topGames,
        recentRows.map((row) => projectCommunityGameSourceRow(row)),
        firstPlayRows.map((row) => projectCommunityGameFirstPlayRow(row)),
        mappings,
        { from: input.from, to: input.to },
      ),
    };
  } catch (error) {
    console.error('community_game_insights_read_failed', error);
    return null;
  }
}
/**
 * v6 overview leaderboards (S9, #1081): three member
 * rankings beyond raw play time, all from
 * community_game_activity_daily. gameCount counts each
 * member's distinct unified games, so it reuses the v5
 * per-user source rows and resolves them through the same
 * identity as the overview games; playDays counts distinct
 * activity dates per member (the user insights figure,
 * ranked); growth compares each member's total against the
 * previous period — the same-length window immediately
 * before the range, derived here on the supply side — and
 * keeps only members with at least one previous hour and a
 * positive increase (the lib builder owns that rule). Same
 * fail-soft and casting rules as the other sections: a
 * failure logs and degrades the whole section to null.
 */
async function readOverviewLeaderboards(
  input: CommunityGameStatsInput,
  mappings: CommunityGameIdentityMapping[],
): Promise<CommunityLeaderboardsOverview | null> {
  try {
    const previousRange = communityGamePreviousRange({ from: input.from, to: input.to });
    const userRows = await prisma.$queryRaw<
      Array<{
        discordUserId: string;
        name: string;
        applicationId: string;
        totalSeconds: bigint;
      }>
    >`SELECT user_id AS "discordUserId", activity_name AS name,
        application_id AS "applicationId", SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id, activity_name, application_id`;
    const gameCounts = buildCommunityLeaderboardGameCounts(
      userRows.map((row) => projectCommunityGameUserSourceRow(row)),
      mappings,
    );
    const gameCountItems = gameCounts.slice(input.offset, input.offset + input.limit);
    const playDayRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; playDays: number }>
    >`SELECT user_id AS "discordUserId", COUNT(DISTINCT activity_date)::int AS "playDays"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id
      ORDER BY COUNT(DISTINCT activity_date) DESC, user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`;
    const playDayCounts = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total FROM (
        SELECT user_id FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id) ranked_users`;
    const playDayTotal = playDayCounts[0]?.total ?? 0;
    const growthRows = await prisma.$queryRaw<
      Array<{ discordUserId: string; currentSeconds: bigint; previousSeconds: bigint }>
    >`SELECT user_id AS "discordUserId",
        SUM(CASE WHEN activity_date >= ${input.from}::date THEN value ELSE 0 END)::bigint AS "currentSeconds",
        SUM(CASE WHEN activity_date < ${input.from}::date THEN value ELSE 0 END)::bigint AS "previousSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${previousRange.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id`;
    const growth = buildCommunityLeaderboardGrowth(
      growthRows.map((row) => projectCommunityLeaderboardGrowthRow(row)),
    );
    const growthItems = growth.slice(input.offset, input.offset + input.limit);
    return {
      gameCount: {
        items: gameCountItems,
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total: gameCounts.length,
          hasNext: input.offset + gameCountItems.length < gameCounts.length,
        },
      },
      playDays: {
        items: playDayRows.map((row) => projectCommunityLeaderboardPlayDaysRow(row)),
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total: playDayTotal,
          hasNext: input.offset + playDayRows.length < playDayTotal,
        },
      },
      growth: {
        items: growthItems,
        pagination: {
          limit: input.limit,
          offset: input.offset,
          total: growth.length,
          hasNext: input.offset + growthItems.length < growth.length,
        },
        previousRange,
      },
    };
  } catch (error) {
    console.error('community_leaderboards_read_failed', error);
    return null;
  }
}
/**
 * v7 overview weekly champions (S10, #1082): for every
 * Monday-start week the range touches, the week's leader
 * candidates by total play seconds — the raw list the
 * relay counts weekly titles from (promoting the next
 * candidate when a leader is opted out), so the supply
 * applies no opt-out and fixes no champion here. One
 * grouped read over community_game_activity_daily; the
 * lib builder orders the weeks, sorts and caps the
 * candidates. Same fail-soft and casting rules as the
 * other sections.
 */
async function readOverviewWeeklyChampions(
  input: CommunityGameStatsInput,
): Promise<CommunityWeeklyChampionsOverview | null> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ weekStart: Date | string; discordUserId: string; totalSeconds: bigint }>
    >`SELECT date_trunc('week', activity_date)::date AS "weekStart",
        user_id AS "discordUserId", SUM(value)::bigint AS "totalSeconds"
      FROM community_game_activity_daily
      WHERE guild_id = ${input.guildId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY date_trunc('week', activity_date), user_id`;
    return {
      weeks: buildCommunityWeeklyChampions(
        rows.map((row) => projectCommunityWeeklyChampionRow(row)),
      ),
    };
  } catch (error) {
    console.error('community_weekly_champions_read_failed', error);
    return null;
  }
}
/**
 * The stored metric behind a channel-mode metric: the
 * wire names the axis (voice stay / message count), the
 * channel table stores the bot's metric names.
 */
const COMMUNITY_CHANNEL_DB_METRIC: Record<CommunityChannelMetric, string> = {
  voice: 'voice_seconds',
  messages: 'messages',
};
interface CommunityChannelRankingDetail {
  name: string | null;
  recordedFrom: string | null;
  totalValue: number;
  memberCount: number;
  items: Array<{ discordUserId: string; totalValue: number }>;
  pagination: ActivityPagination;
  viewer: { discordUserId: string; rank: number | null; totalValue: number } | null;
}
/**
 * v7 channel mode (S10, #1082): one channel's member
 * ranking from community_activity_channel_daily, the
 * channel drill-down behind the v4 channels section.
 * Like the game mode this is the response's main content,
 * so a read failure propagates to the 503 catch; a
 * channel with no rows in the range is not a failure and
 * reports zeroed totals with an empty ranking. The
 * channel total is the sum over the same rows the
 * ranking pages through, so the two always agree with
 * the v4 per-channel aggregate for the channel. The
 * channel name resolves through the same guild-options
 * lookup as the v4 section and degrades to null. The
 * viewer follows the game mode: competition rank over
 * all members of the channel, null when the viewer has
 * no record in it.
 */
async function readChannelRanking(
  input: CommunityGameStatsInput,
): Promise<CommunityChannelRankingDetail> {
  const channelId = input.channelId as string;
  const dbMetric = COMMUNITY_CHANNEL_DB_METRIC[input.channelMetric as CommunityChannelMetric];
  const recordedRows = await prisma.$queryRaw<Array<{ recordedFrom: Date | string | null }>>`
    SELECT MIN(activity_date) AS "recordedFrom" FROM community_activity_channel_daily
    WHERE guild_id = ${input.guildId}`;
  const totalsRows = await prisma.$queryRaw<
    Array<{ totalValue: bigint | null; memberCount: number }>
  >`SELECT SUM(value)::bigint AS "totalValue",
      COUNT(DISTINCT user_id)::int AS "memberCount"
    FROM community_activity_channel_daily
    WHERE guild_id = ${input.guildId} AND channel_id = ${channelId} AND metric = ${dbMetric}
      AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
  const memberRows = await prisma.$queryRaw<
    Array<{ discordUserId: string; totalValue: bigint }>
  >`SELECT user_id AS "discordUserId", SUM(value)::bigint AS "totalValue"
    FROM community_activity_channel_daily
    WHERE guild_id = ${input.guildId} AND channel_id = ${channelId} AND metric = ${dbMetric}
      AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
    GROUP BY user_id
    ORDER BY SUM(value) DESC, user_id ASC
    LIMIT ${input.limit} OFFSET ${input.offset}`;
  const countRows = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COUNT(*)::int AS total FROM (
      SELECT user_id FROM community_activity_channel_daily
      WHERE guild_id = ${input.guildId} AND channel_id = ${channelId} AND metric = ${dbMetric}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
      GROUP BY user_id) ranked_members`;
  const total = countRows[0]?.total ?? 0;
  let viewer: CommunityChannelRankingDetail['viewer'] = null;
  if (input.discordUserId !== null) {
    const viewerRows = await prisma.$queryRaw<Array<{ totalValue: bigint | null }>>`
      SELECT SUM(value)::bigint AS "totalValue" FROM community_activity_channel_daily
      WHERE guild_id = ${input.guildId} AND channel_id = ${channelId} AND metric = ${dbMetric}
        AND user_id = ${input.discordUserId}
        AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
    const viewerValue = toCommunityGameSeconds(viewerRows[0]?.totalValue ?? 0n);
    let rank: number | null = null;
    if (viewerValue > 0) {
      const aheadRows = await prisma.$queryRaw<Array<{ ahead: number }>>`
        SELECT COUNT(*)::int AS ahead FROM (
          SELECT user_id FROM community_activity_channel_daily
          WHERE guild_id = ${input.guildId} AND channel_id = ${channelId}
            AND metric = ${dbMetric}
            AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
          GROUP BY user_id
          HAVING SUM(value) > ${BigInt(viewerValue)}) ahead_members`;
      rank = (aheadRows[0]?.ahead ?? 0) + 1;
    }
    viewer = { discordUserId: input.discordUserId, rank, totalValue: viewerValue };
  }
  let name: string | null = null;
  try {
    const options = await getGuildConfigurationOptionsCached(input.guildId);
    name = projectCommunityChannelName(
      (options?.channels ?? []).find((channel) => channel.id === channelId)?.name,
    );
  } catch {
    // Names degrade to null; the ranking itself stands.
  }
  return {
    name,
    recordedFrom: formatCommunityGameEarliestDate(recordedRows[0]?.recordedFrom),
    totalValue: toCommunityGameSeconds(totalsRows[0]?.totalValue ?? 0n),
    memberCount: totalsRows[0]?.memberCount ?? 0,
    items: memberRows.map((row) => ({
      discordUserId: row.discordUserId,
      totalValue: row.totalValue,
    })),
    pagination: {
      limit: input.limit,
      offset: input.offset,
      total,
      hasNext: input.offset + memberRows.length < total,
    },
    viewer,
  };
}
/**
 * v5 game mode by application id / unified key (S7b,
 * #1060): the selector resolves to one unified game; its
 * source rows are fetched per selector (by id, or by name
 * restricted to id-less rows — the rows a name mapping is
 * allowed to claim) and filtered through the same
 * resolution the overview applies, so a superset fetch
 * can never leak another game's rows into the detail.
 * Like the v3 game mode this is the response's main
 * content: a read failure propagates to the 503 catch.
 */
async function readGameDetailV5(
  input: CommunityGameStatsInput,
  mappings: CommunityGameIdentityMapping[],
): Promise<{
  game: CommunityGameDetailV5;
  players: {
    items: Array<{ discordUserId: string; totalSeconds: number }>;
    pagination: ActivityPagination;
  };
  viewer: CommunityGameViewer | null;
}> {
  let targetKey: string;
  let selectorIds: string[] = [];
  let selectorNames: string[] = [];
  let fallbackName: string;
  let fallbackApplicationId: string | null;
  const applicationId =
    input.gameApplicationId ?? (input.gameKey?.startsWith('app:') ? input.gameKey.slice(4) : null);
  if (applicationId !== null) {
    const mapping = findCommunityGameMappingByApplicationId(mappings, applicationId);
    targetKey = resolveCommunityGame('', applicationId, mappings).key;
    selectorIds = mapping ? [...mapping.applicationIds] : [applicationId];
    selectorNames = mapping ? [...mapping.activityNames, mapping.canonicalName] : [];
    fallbackName = mapping?.canonicalName ?? targetKey;
    fallbackApplicationId = mapping?.applicationIds[0] ?? applicationId;
  } else {
    const name = (input.gameKey as string).slice(5);
    const mapping = findCommunityGameMappingByName(mappings, name);
    targetKey = resolveCommunityGame(name, null, mappings).key;
    selectorIds = mapping ? [...mapping.applicationIds] : [];
    selectorNames = mapping ? [...mapping.activityNames, mapping.canonicalName] : [name];
    fallbackName = mapping?.canonicalName ?? name;
    fallbackApplicationId = mapping?.applicationIds[0] ?? null;
  }
  type DetailRow = {
    discordUserId: string;
    name: string;
    applicationId: string;
    totalSeconds: bigint;
    firstPlayDate: Date | string;
    lastPlayDate: Date | string;
  };
  const fetched: DetailRow[] = [];
  for (const id of selectorIds) {
    fetched.push(
      ...(await prisma.$queryRaw<DetailRow[]>`SELECT user_id AS "discordUserId",
          activity_name AS name, application_id AS "applicationId",
          SUM(value)::bigint AS "totalSeconds",
          MIN(activity_date) AS "firstPlayDate", MAX(activity_date) AS "lastPlayDate"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND application_id = ${id}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id, activity_name, application_id`),
    );
  }
  for (const name of selectorNames) {
    fetched.push(
      ...(await prisma.$queryRaw<DetailRow[]>`SELECT user_id AS "discordUserId",
          activity_name AS name, application_id AS "applicationId",
          SUM(value)::bigint AS "totalSeconds",
          MIN(activity_date) AS "firstPlayDate", MAX(activity_date) AS "lastPlayDate"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND application_id = '' AND activity_name = ${name}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id, activity_name, application_id`),
    );
  }
  const rows = fetched
    .map((row) => projectCommunityGameDetailSourceRow(row))
    .filter((row) => resolveCommunityGame(row.name, row.applicationId, mappings).key === targetKey);
  const groups = groupCommunityGameRows(rows, mappings);
  const identity = groups[0]
    ? communityGameGroupIdentity(groups[0])
    : { key: targetKey, name: fallbackName, applicationId: fallbackApplicationId };
  const secondsByUser = new Map<string, number>();
  let totalSeconds = 0;
  let firstPlayDate: string | null = null;
  let lastPlayDate: string | null = null;
  for (const row of rows) {
    totalSeconds += row.totalSeconds;
    secondsByUser.set(
      row.discordUserId,
      (secondsByUser.get(row.discordUserId) ?? 0) + row.totalSeconds,
    );
    if (firstPlayDate === null || row.firstPlayDate < firstPlayDate)
      firstPlayDate = row.firstPlayDate;
    if (lastPlayDate === null || row.lastPlayDate > lastPlayDate) lastPlayDate = row.lastPlayDate;
  }
  const players = [...secondsByUser.entries()]
    .map(([discordUserId, seconds]) => ({ discordUserId, totalSeconds: seconds }))
    .sort(
      (a, b) => b.totalSeconds - a.totalSeconds || a.discordUserId.localeCompare(b.discordUserId),
    );
  let viewer: CommunityGameViewer | null = null;
  if (input.discordUserId !== null) {
    const viewerSeconds = secondsByUser.get(input.discordUserId) ?? 0;
    viewer = {
      discordUserId: input.discordUserId,
      rank:
        viewerSeconds > 0
          ? players.filter((player) => player.totalSeconds > viewerSeconds).length + 1
          : null,
      totalSeconds: viewerSeconds,
    };
  }
  const playerItems = players.slice(input.offset, input.offset + input.limit);
  return {
    game: {
      ...identity,
      totalSeconds,
      playerCount: players.length,
      firstPlayDate,
      lastPlayDate,
    },
    players: {
      items: playerItems,
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total: players.length,
        hasNext: input.offset + playerItems.length < players.length,
      },
    },
    viewer,
  };
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
    const mappings = input.version >= 5 ? await readGameIdentityMappings(input.guildId) : [];
    if (input.mode === 'game' && input.version >= 5 && input.gameName === null) {
      // v5 game mode by application id / unified key (S7b):
      // the detail covers the whole unified game, not one
      // recorded name. Main content, so failures reach the
      // 503 catch like the v3 game mode.
      const detail = await readGameDetailV5(input, mappings);
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'game',
        range,
        meta,
        game: detail.game,
        players: detail.players,
        viewer: detail.viewer,
      });
    }
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
      // In v5 a gameName lookup keeps the exact-name
      // figures of v3/v4; key / applicationId report the
      // unified identity the name resolves to on its own
      // (the relay addresses unified games by key instead).
      const resolution = input.version >= 5 ? resolveCommunityGame(gameName, null, mappings) : null;
      const gameDetail: CommunityGameDetail | CommunityGameDetailV5 = resolution
        ? {
            key: resolution.key,
            name: detail.name,
            applicationId: resolution.applicationId,
            totalSeconds: detail.totalSeconds,
            playerCount: detail.playerCount,
            firstPlayDate: detail.firstPlayDate,
            lastPlayDate: detail.lastPlayDate,
          }
        : detail;
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'game',
        range,
        meta,
        game: gameDetail,
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
    if (input.mode === 'channel') {
      // v7 channel mode (S10, #1082): one channel's member
      // ranking, the drill-down behind the v4 channels
      // section. Like the game mode this is the response's
      // main content, so a read failure is a 503, not a
      // null; the items and the viewer carry the metric's
      // own field (totalSeconds for voice, totalCount for
      // messages).
      const detail = await readChannelRanking(input);
      const voice = input.channelMetric === 'voice';
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'channel',
        range,
        meta,
        channel: {
          channelId: input.channelId as string,
          name: detail.name,
          metric: input.channelMetric as CommunityChannelMetric,
          ...(voice ? { totalSeconds: detail.totalValue } : { totalCount: detail.totalValue }),
          memberCount: detail.memberCount,
          recordedFrom: detail.recordedFrom,
        },
        members: {
          items: detail.items.map((item) =>
            voice
              ? projectCommunityChannelVoiceMemberRow({
                  discordUserId: item.discordUserId,
                  totalSeconds: item.totalValue,
                })
              : projectCommunityChannelMessageMemberRow({
                  discordUserId: item.discordUserId,
                  totalCount: item.totalValue,
                }),
          ),
          pagination: detail.pagination,
        },
        viewer:
          detail.viewer === null
            ? null
            : {
                discordUserId: detail.viewer.discordUserId,
                rank: detail.viewer.rank,
                ...(voice
                  ? { totalSeconds: detail.viewer.totalValue }
                  : { totalCount: detail.viewer.totalValue }),
              },
      });
    }
    if (input.mode === 'user') {
      const userId = input.discordUserId as string;
      const totals = await prisma.$queryRaw<Array<{ totalSeconds: bigint | null }>>`
        SELECT SUM(value)::bigint AS "totalSeconds" FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId} AND user_id = ${userId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date`;
      let games: CommunityUserGameItem[] | CommunityUserGameItemV5[];
      if (input.version >= 5) {
        // v5 user games (S7b): the member's rows unified
        // like the overview games. The SQL cap moves into
        // the grouping — capping source rows first could
        // cut a unified game whose names rank low apart.
        const rows = await prisma.$queryRaw<
          Array<{ name: string; applicationId: string; totalSeconds: bigint }>
        >`SELECT activity_name AS name, application_id AS "applicationId",
            SUM(value)::bigint AS "totalSeconds"
          FROM community_game_activity_daily
          WHERE guild_id = ${input.guildId} AND user_id = ${userId}
            AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
          GROUP BY activity_name, application_id`;
        games = buildCommunityUserGamesV5(
          rows.map((row) => projectCommunityGameSourceRow(row)),
          mappings,
        ).slice(0, COMMUNITY_GAME_STATS_GAMES_LIMIT);
      } else {
        const rows = await prisma.$queryRaw<
          Array<{ name: string; totalSeconds: bigint }>
        >`SELECT activity_name AS name, SUM(value)::bigint AS "totalSeconds"
          FROM community_game_activity_daily
          WHERE guild_id = ${input.guildId} AND user_id = ${userId}
            AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
          GROUP BY activity_name
          ORDER BY SUM(value) DESC, activity_name ASC
          LIMIT ${COMMUNITY_GAME_STATS_GAMES_LIMIT}`;
        games = rows.map((row) => projectCommunityUserGameRow(row));
      }
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'user',
        range,
        meta,
        user: {
          discordUserId: userId,
          totalSeconds: toCommunityGameSeconds(totals[0]?.totalSeconds ?? 0n),
          games,
        },
        ...(input.version >= 2
          ? {
              activity:
                input.version >= 4
                  ? await readUserActivityV4(input)
                  : await readUserActivity(input),
            }
          : {}),
        ...(input.version >= 3 ? { insights: await readUserInsights(input) } : {}),
      });
    }
    if (input.version >= 5) {
      // v5 overview (S7b, #1060): games and the ranking
      // aggregate per-user source rows through the unified
      // identity — the games cap and the ranking pagination
      // move into the aggregation, because unified totals
      // only exist after grouping. Activity and channels
      // keep the v2 / v4 reads; insights use the v5 variant.
      // v6 adds the leaderboards section on top (S9, #1081)
      // and v7 the weekly champions section (S10, #1082);
      // every other section is the v5 read unchanged.
      const userRows = await prisma.$queryRaw<
        Array<{
          discordUserId: string;
          name: string;
          applicationId: string;
          totalSeconds: bigint;
        }>
      >`SELECT user_id AS "discordUserId", activity_name AS name,
          application_id AS "applicationId", SUM(value)::bigint AS "totalSeconds"
        FROM community_game_activity_daily
        WHERE guild_id = ${input.guildId}
          AND activity_date >= ${input.from}::date AND activity_date <= ${input.to}::date
        GROUP BY user_id, activity_name, application_id`;
      const aggregated = aggregateCommunityGamesOverviewV5(
        userRows.map((row) => projectCommunityGameUserSourceRow(row)),
        mappings,
      );
      const rankingItems = aggregated.users.slice(input.offset, input.offset + input.limit);
      return reply({
        status: 'ok',
        guildId: input.guildId,
        mode: 'overview',
        range,
        meta,
        games: aggregated.games.slice(0, COMMUNITY_GAME_STATS_GAMES_LIMIT).map((game) => ({
          ...game.identity,
          totalSeconds: game.totalSeconds,
          playerCount: game.playerCount,
        })),
        ranking: {
          items: rankingItems.map((user) => ({
            discordUserId: user.discordUserId,
            totalSeconds: user.totalSeconds,
            topGameName: user.topGame.name,
            topGameKey: user.topGame.key,
          })),
          pagination: {
            limit: input.limit,
            offset: input.offset,
            total: aggregated.users.length,
            hasNext: input.offset + rankingItems.length < aggregated.users.length,
          },
        },
        activity: await readOverviewActivity(input),
        insights: await readOverviewInsightsV5(input, mappings),
        channels: await readOverviewChannels(input),
        ...(input.version >= 6
          ? { leaderboards: await readOverviewLeaderboards(input, mappings) }
          : {}),
        ...(input.version === 7
          ? { weeklyChampions: await readOverviewWeeklyChampions(input) }
          : {}),
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
      ...(input.version === 3 || input.version === 4
        ? { insights: await readOverviewInsights(input) }
        : {}),
      ...(input.version === 4 ? { channels: await readOverviewChannels(input) } : {}),
    });
  } catch (error) {
    console.error('community_game_stats_read_failed', error);
    return reply({ error: 'community_game_stats_unavailable' }, 503);
  }
}
