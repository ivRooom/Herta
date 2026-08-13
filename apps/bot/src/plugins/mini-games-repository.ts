import type { PrismaClient } from '@herta/db';

export const MINI_GAME_METRICS = [
  'minigame_plays',
  'minigame_wins',
  'coinflip_plays',
  'coinflip_predictions',
  'coinflip_wins',
  'highlow_plays',
  'highlow_round_wins',
  'highlow_clears',
  'highlow_best_streak',
  'blackjack_plays',
  'blackjack_wins',
  'blackjack_pushes',
  'blackjack_naturals',
  'dice_plays',
  'chinchiro_plays',
  'chinchiro_shigoro',
  'chinchiro_zorome',
  'chinchiro_hifumi',
] as const;

export type MiniGameMetric = (typeof MINI_GAME_METRICS)[number];

export const MINI_GAME_LEADERBOARD_METRICS = [
  'wins',
  'plays',
  'coinflip',
  'highlow',
  'blackjack',
  'chinchiro',
] as const;

export type MiniGameLeaderboardMetric = (typeof MINI_GAME_LEADERBOARD_METRICS)[number];

export interface MiniGameStats {
  totalPlays: number;
  totalWins: number;
  coinflipPlays: number;
  coinflipPredictions: number;
  coinflipWins: number;
  highlowPlays: number;
  highlowRoundWins: number;
  highlowClears: number;
  highlowBestStreak: number;
  blackjackPlays: number;
  blackjackWins: number;
  blackjackPushes: number;
  blackjackNaturals: number;
  dicePlays: number;
  chinchiroPlays: number;
  chinchiroShigoro: number;
  chinchiroZorome: number;
  chinchiroHifumi: number;
}

export interface MiniGameLeaderboardRecord {
  userId: string;
  value: number;
}

interface MiniGameMetricRow {
  metric: MiniGameMetric;
  total: bigint;
}

interface MiniGameLeaderboardRow {
  userId: string;
  total: bigint;
}

export async function incrementMiniGameMetric(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: MiniGameMetric,
  amount = 1,
  now = new Date(),
): Promise<void> {
  const safeAmount = Math.max(0, Math.trunc(amount));
  if (safeAmount === 0) return;
  const activityDate = jstDateKey(now);
  await prisma.$executeRaw`
    INSERT INTO "community_activity_daily" (
      "guild_id", "user_id", "activity_date", "metric", "value"
    ) VALUES (
      ${guildId}, ${userId}, ${activityDate}::date, ${metric}, ${BigInt(safeAmount)}
    )
    ON CONFLICT ("guild_id", "user_id", "activity_date", "metric")
    DO UPDATE SET "value" = "community_activity_daily"."value" + EXCLUDED."value"
  `;
}

export async function recordMiniGameMaximum(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metric: 'highlow_best_streak',
  value: number,
  now = new Date(),
): Promise<void> {
  const safeValue = Math.max(0, Math.trunc(value));
  if (safeValue === 0) return;
  const activityDate = jstDateKey(now);
  await prisma.$executeRaw`
    INSERT INTO "community_activity_daily" (
      "guild_id", "user_id", "activity_date", "metric", "value"
    ) VALUES (
      ${guildId}, ${userId}, ${activityDate}::date, ${metric}, ${BigInt(safeValue)}
    )
    ON CONFLICT ("guild_id", "user_id", "activity_date", "metric")
    DO UPDATE SET "value" = GREATEST("community_activity_daily"."value", EXCLUDED."value")
  `;
}

export async function getMiniGameStats(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
): Promise<MiniGameStats> {
  const rows = await prisma.$queryRaw<MiniGameMetricRow[]>`
    SELECT
      "metric"::text AS "metric",
      CASE
        WHEN "metric" = 'highlow_best_streak' THEN MAX("value")
        ELSE SUM("value")
      END::bigint AS "total"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${guildId}
      AND "user_id" = ${userId}
      AND "metric" IN (
        'minigame_plays', 'minigame_wins',
        'coinflip_plays', 'coinflip_predictions', 'coinflip_wins',
        'highlow_plays', 'highlow_round_wins', 'highlow_clears', 'highlow_best_streak',
        'blackjack_plays', 'blackjack_wins', 'blackjack_pushes', 'blackjack_naturals',
        'dice_plays',
        'chinchiro_plays', 'chinchiro_shigoro', 'chinchiro_zorome', 'chinchiro_hifumi'
      )
    GROUP BY "metric"
  `;
  return miniGameStatsFromRows(rows);
}

export async function getMiniGameLeaderboard(
  prisma: PrismaClient,
  guildId: string,
  metric: MiniGameLeaderboardMetric,
  limit = 10,
): Promise<MiniGameLeaderboardRecord[]> {
  const databaseMetric = leaderboardDatabaseMetric(metric);
  const safeLimit = Math.min(25, Math.max(3, Math.trunc(limit)));
  const rows = await prisma.$queryRaw<MiniGameLeaderboardRow[]>`
    SELECT
      "user_id" AS "userId",
      CASE
        WHEN ${databaseMetric} = 'highlow_best_streak' THEN MAX("value")
        ELSE SUM("value")
      END::bigint AS "total"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${guildId}
      AND "metric" = ${databaseMetric}
    GROUP BY "user_id"
    HAVING SUM("value") > 0
    ORDER BY "total" DESC, "user_id" ASC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({ userId: row.userId, value: Math.max(0, Number(row.total)) }));
}

export function miniGameStatsFromRows(
  rows: readonly { metric: MiniGameMetric; total: bigint | number }[],
): MiniGameStats {
  const values = new Map<MiniGameMetric, number>();
  for (const row of rows) values.set(row.metric, Number(row.total));
  const value = (metric: MiniGameMetric): number => Math.max(0, values.get(metric) ?? 0);
  return {
    totalPlays: value('minigame_plays'),
    totalWins: value('minigame_wins'),
    coinflipPlays: value('coinflip_plays'),
    coinflipPredictions: value('coinflip_predictions'),
    coinflipWins: value('coinflip_wins'),
    highlowPlays: value('highlow_plays'),
    highlowRoundWins: value('highlow_round_wins'),
    highlowClears: value('highlow_clears'),
    highlowBestStreak: value('highlow_best_streak'),
    blackjackPlays: value('blackjack_plays'),
    blackjackWins: value('blackjack_wins'),
    blackjackPushes: value('blackjack_pushes'),
    blackjackNaturals: value('blackjack_naturals'),
    dicePlays: value('dice_plays'),
    chinchiroPlays: value('chinchiro_plays'),
    chinchiroShigoro: value('chinchiro_shigoro'),
    chinchiroZorome: value('chinchiro_zorome'),
    chinchiroHifumi: value('chinchiro_hifumi'),
  };
}

export function miniGameLeaderboardMetricLabel(metric: MiniGameLeaderboardMetric): string {
  switch (metric) {
    case 'wins':
      return '総勝利数';
    case 'plays':
      return '総プレイ数';
    case 'coinflip':
      return 'Coin Flip 的中数';
    case 'highlow':
      return 'High-Low 最高連勝';
    case 'blackjack':
      return 'Blackjack 勝利数';
    case 'chinchiro':
      return 'チンチロ シゴロ回数';
  }
}

function leaderboardDatabaseMetric(metric: MiniGameLeaderboardMetric): MiniGameMetric {
  switch (metric) {
    case 'wins':
      return 'minigame_wins';
    case 'plays':
      return 'minigame_plays';
    case 'coinflip':
      return 'coinflip_wins';
    case 'highlow':
      return 'highlow_best_streak';
    case 'blackjack':
      return 'blackjack_wins';
    case 'chinchiro':
      return 'chinchiro_shigoro';
  }
}

function jstDateKey(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
