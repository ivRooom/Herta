import type { PrismaClient } from '@prisma/client';

export interface CommunityActiveUserCounts {
  dau: number;
  wau: number;
  mau: number;
}

export interface CommunityNewVsReturningUsers {
  newUsers: number;
  returningUsers: number;
}

/**
 * asOf時点でのDAU(当日)/WAU(直近7日)/MAU(直近30日)。
 * metricを問わず(発言・VC・リアクション等いずれか)activityがあったuser数。
 */
export async function getCommunityActiveUserCounts(
  prisma: PrismaClient,
  input: { guildId: string; asOf: Date },
): Promise<CommunityActiveUserCounts> {
  const dayStart = (offsetDays: number) => new Date(input.asOf.getTime() - offsetDays * 86_400_000);

  const rows = await prisma.$queryRaw<Array<{ window: string; count: bigint }>>`
    SELECT 'dau' AS "window", COUNT(DISTINCT "user_id")::bigint AS "count"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${input.guildId}
      AND "activity_date" = ${input.asOf}
    UNION ALL
    SELECT 'wau' AS "window", COUNT(DISTINCT "user_id")::bigint AS "count"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${input.guildId}
      AND "activity_date" >= ${dayStart(6)}
      AND "activity_date" <= ${input.asOf}
    UNION ALL
    SELECT 'mau' AS "window", COUNT(DISTINCT "user_id")::bigint AS "count"
    FROM "community_activity_daily"
    WHERE "guild_id" = ${input.guildId}
      AND "activity_date" >= ${dayStart(29)}
      AND "activity_date" <= ${input.asOf}
  `;

  const byWindow = new Map(rows.map((row) => [row.window, Number(row.count)]));
  return {
    dau: byWindow.get('dau') ?? 0,
    wau: byWindow.get('wau') ?? 0,
    mau: byWindow.get('mau') ?? 0,
  };
}

/**
 * 選択期間[start, end]でactivityがあったuserを、期間より前にもactivity履歴が
 * あるか(Returning)、期間内が初出か(New)で分類する。
 */
export async function getCommunityNewVsReturningUsers(
  prisma: PrismaClient,
  input: { guildId: string; start: Date; end: Date },
): Promise<CommunityNewVsReturningUsers> {
  const rows = await prisma.$queryRaw<Array<{ isReturning: boolean; count: bigint }>>`
    WITH period_users AS (
      SELECT DISTINCT "user_id"
      FROM "community_activity_daily"
      WHERE "guild_id" = ${input.guildId}
        AND "activity_date" >= ${input.start}
        AND "activity_date" <= ${input.end}
    ), classified AS (
      SELECT
        p."user_id",
        EXISTS (
          SELECT 1
          FROM "community_activity_daily" prior
          WHERE prior."guild_id" = ${input.guildId}
            AND prior."user_id" = p."user_id"
            AND prior."activity_date" < ${input.start}
        ) AS "is_returning"
      FROM period_users p
    )
    SELECT "is_returning" AS "isReturning", COUNT(*)::bigint AS "count"
    FROM classified
    GROUP BY "is_returning"
  `;

  let newUsers = 0;
  let returningUsers = 0;
  for (const row of rows) {
    if (row.isReturning) returningUsers = Number(row.count);
    else newUsers = Number(row.count);
  }
  return { newUsers, returningUsers };
}
