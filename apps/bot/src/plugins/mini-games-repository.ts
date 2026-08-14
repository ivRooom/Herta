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
] as const;

export type MiniGameMetric = (typeof MINI_GAME_METRICS)[number];

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
}

interface MiniGameMetricRow {
  metric: MiniGameMetric;
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

export async function incrementMiniGameMetrics(
  prisma: PrismaClient,
  guildId: string,
  userId: string,
  metrics: readonly (readonly [MiniGameMetric, number])[],
  now = new Date(),
): Promise<void> {
  const updates = metrics
    .map(([metric, amount]) => [metric, Math.max(0, Math.trunc(amount))] as const)
    .filter(([, amount]) => amount > 0);
  if (updates.length === 0) return;
  const activityDate = jstDateKey(now);
  await prisma.$transaction(
    updates.map(
      ([metric, amount]) =>
        prisma.$executeRaw`
        INSERT INTO "community_activity_daily" (
          "guild_id", "user_id", "activity_date", "metric", "value"
        ) VALUES (
          ${guildId}, ${userId}, ${activityDate}::date, ${metric}, ${BigInt(amount)}
        )
        ON CONFLICT ("guild_id", "user_id", "activity_date", "metric")
        DO UPDATE SET "value" = "community_activity_daily"."value" + EXCLUDED."value"
      `,
    ),
  );
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
        'blackjack_plays', 'blackjack_wins', 'blackjack_pushes', 'blackjack_naturals'
      )
    GROUP BY "metric"
  `;
  return miniGameStatsFromRows(rows);
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
  };
}

function jstDateKey(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
