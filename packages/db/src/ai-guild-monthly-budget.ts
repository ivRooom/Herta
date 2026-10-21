import type { PrismaClient } from '@prisma/client';
import { startOfJstMonth } from './ai-generation-analytics.js';

export interface GuildMonthlyBudgetReservation {
  allowed: boolean;
  reservedTotalMicroUsd: number;
  periodStart: Date;
}

/**
 * Guild単位の月次AI予算(Issue #519)をatomicにreserveする。1本のUPSERT(INSERT ... ON
 * CONFLICT DO UPDATE ... RETURNING)でreservedMicroUsdへ加算と読み取りを同時に行うため、
 * 同一guildへの並行リクエストでも予算超過を防げる(読み取り→判定→書き込みの3ステップに
 * 分けないことがポイント)。上限を超える場合はこの呼び出し分だけ差し戻し、
 * allowed: falseを返す。
 */
export async function reserveGuildMonthlyBudget(
  prisma: PrismaClient,
  input: { guildId: string; amountMicroUsd: number; limitMicroUsd: number; now?: Date },
): Promise<GuildMonthlyBudgetReservation> {
  const periodStart = startOfJstMonth(input.now ?? new Date());
  const amount = BigInt(Math.max(0, Math.round(input.amountMicroUsd)));

  const rows = await prisma.$queryRaw<Array<{ reservedMicroUsd: bigint }>>`
    INSERT INTO "ai_guild_monthly_budget_usage" ("guild_id", "period_start", "reserved_micro_usd")
    VALUES (${input.guildId}, ${periodStart}, ${amount})
    ON CONFLICT ("guild_id", "period_start")
    DO UPDATE SET "reserved_micro_usd" = "ai_guild_monthly_budget_usage"."reserved_micro_usd" + ${amount}
    RETURNING "reserved_micro_usd" AS "reservedMicroUsd"
  `;
  const reservedTotalMicroUsd = Number(rows[0]?.reservedMicroUsd ?? 0n);

  if (reservedTotalMicroUsd > input.limitMicroUsd) {
    // この呼び出し分の予約を差し戻す(他の既存予約には触れない)。
    await settleGuildMonthlyBudgetDelta(prisma, input.guildId, periodStart, -input.amountMicroUsd);
    return {
      allowed: false,
      reservedTotalMicroUsd: reservedTotalMicroUsd - Number(amount),
      periodStart,
    };
  }
  return { allowed: true, reservedTotalMicroUsd, periodStart };
}

/**
 * reserveGuildMonthlyBudgetで確保した分を、実コストとの差分(deltaMicroUsd)で調整する。
 * 失敗時(呼び出し自体が不成立)はreserve時の全額をマイナスで渡して解放する。
 * 0未満には丸めない(他の並行予約と相殺してマイナスにならないようGREATEST(0, ...)で保護)。
 */
export async function settleGuildMonthlyBudgetDelta(
  prisma: PrismaClient,
  guildId: string,
  periodStart: Date,
  deltaMicroUsd: number,
): Promise<void> {
  if (deltaMicroUsd === 0) return;
  const delta = BigInt(Math.round(deltaMicroUsd));
  await prisma.$executeRaw`
    UPDATE "ai_guild_monthly_budget_usage"
    SET "reserved_micro_usd" = GREATEST(0, "reserved_micro_usd" + ${delta})
    WHERE "guild_id" = ${guildId} AND "period_start" = ${periodStart}
  `;
}
