import type { PrismaClient } from '@prisma/client';

export interface CommunityPointsRatesInput {
  messagePointsPerMessage: number;
  reactionPointsPerReaction: number;
  voicePointsPer10Minutes: number;
  onlinePointsPerHour: number;
  onlinePointsDailyCap: number;
  gamePointsPerHour: number;
  gamePointsDailyCap: number;
  achievementPoints: number;
  commandPointsPerUse: number;
  commandPointsDailyCap: number;
}

export interface CommunityPointsEntry {
  userId: string;
  points: number;
}

/**
 * 複数ソース(発言・リアクション・VC・オンライン・プレイ中ゲーム・Achievement解除・
 * コマンド使用)を単価・日次上限で重み付けして合算した「Community Points」の
 * 上位を返す。community_activity_daily / community_game_activity_daily /
 * achievement_unlocksを読むだけで、専用の書き込みテーブルは持たない(常に
 * 現在の単価設定で都度計算する導出値)。オンライン・ゲームは1日ごとに上限を
 * 適用してからguild全体で合算するため、日次粒度のCTEで計算する。
 */
export async function getCommunityPointsLeaderboard(
  prisma: PrismaClient,
  input: {
    guildId: string;
    start: Date;
    end: Date;
    rates: CommunityPointsRatesInput;
    limit?: number;
  },
): Promise<CommunityPointsEntry[]> {
  const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 10)));
  const rows = await queryPointsRows(prisma, input);
  return rows.slice(0, limit).map((row) => ({ userId: row.userId, points: Number(row.total) }));
}

interface PointsRow {
  userId: string;
  total: bigint;
}

async function queryPointsRows(
  prisma: PrismaClient,
  input: { guildId: string; start: Date; end: Date; rates: CommunityPointsRatesInput },
): Promise<PointsRow[]> {
  const r = input.rates;
  return prisma.$queryRaw<PointsRow[]>`
    WITH simple_points AS (
      SELECT
        "user_id",
        CASE "metric"
          WHEN 'messages' THEN "value" * ${r.messagePointsPerMessage}::bigint
          WHEN 'reactions_given' THEN "value" * ${r.reactionPointsPerReaction}::bigint
          WHEN 'reactions_received' THEN "value" * ${r.reactionPointsPerReaction}::bigint
          WHEN 'voice_seconds' THEN ("value" / 600) * ${r.voicePointsPer10Minutes}::bigint
          WHEN 'online_seconds' THEN
            LEAST(("value" / 3600) * ${r.onlinePointsPerHour}::bigint, ${r.onlinePointsDailyCap}::bigint)
          WHEN 'commands' THEN
            LEAST("value" * ${r.commandPointsPerUse}::bigint, ${r.commandPointsDailyCap}::bigint)
          ELSE 0::bigint
        END AS "points"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${input.guildId}
        AND "activity_date" >= ${input.start}
        AND "activity_date" <= ${input.end}
        AND "metric" IN ('messages', 'reactions_given', 'reactions_received', 'voice_seconds', 'online_seconds', 'commands')
    ),
    game_points AS (
      SELECT
        "user_id",
        LEAST((SUM("value") / 3600) * ${r.gamePointsPerHour}::bigint, ${r.gamePointsDailyCap}::bigint) AS "points"
      FROM "community_game_activity_daily"
      WHERE "guild_id" = ${input.guildId}
        AND "activity_date" >= ${input.start}
        AND "activity_date" <= ${input.end}
      GROUP BY "user_id", "activity_date"
    ),
    achievement_points AS (
      SELECT
        "user_id",
        COUNT(*)::bigint * ${r.achievementPoints}::bigint AS "points"
      FROM "achievement_unlocks"
      WHERE "guild_id" = ${input.guildId}
        AND "unlocked_at" >= ${input.start}
        AND "unlocked_at" <= ${input.end}
        AND "achievement_id" NOT LIKE 'blocked:%'
      GROUP BY "user_id"
    ),
    combined AS (
      SELECT "user_id", "points" FROM simple_points
      UNION ALL
      SELECT "user_id", "points" FROM game_points
      UNION ALL
      SELECT "user_id", "points" FROM achievement_points
    ),
    totals AS (
      SELECT "user_id", SUM("points")::bigint AS "total"
      FROM combined
      GROUP BY "user_id"
      HAVING SUM("points") > 0
    )
    SELECT "user_id" AS "userId", "total"
    FROM totals
    ORDER BY "total" DESC, "user_id" ASC
  `;
}
