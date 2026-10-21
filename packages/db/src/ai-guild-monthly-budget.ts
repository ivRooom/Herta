import type { PrismaClient } from '@prisma/client';
import { getGuildMonthlyAiSpendUsd, startOfJstMonth } from './ai-generation-analytics.js';

export interface GuildMonthlyBudgetReservation {
  allowed: boolean;
  reservedTotalMicroUsd: number;
  periodStart: Date;
}

/**
 * Guild単位の月次AI予算(Issue #519)をatomicにreserveする。読み取り→判定→書き込みを
 * 複数のSQL文に分けると、(a)判定と差し戻しの間に他リクエストが割り込む、(b)差し戻し自体が
 * 失敗すると超過分がテーブルに残り続ける、という2つのレースが生じる(Codexレビュー指摘)。
 * これを避けるため、1本のSQL文(CTEで現在値をロック付きで取得→同じ文の中で条件付き加算)で
 * reserveを完結させる。
 *
 * - 1つ目のCTE(current_row)はINSERT ... ON CONFLICT DO UPDATE(no-op)で対象行をロックしつつ
 *   現在値を取得する。行が無ければai_generation_events(監査ログ)から当月の既存消費分を
 *   シードする(Codexレビュー指摘: この機能を月の途中でデプロイしても、既に発生済みの
 *   コストを無視して上限まで再度使われてしまわないようにする)。
 * - 2つ目のCTE(applied)は、current_rowで取得した値に対してamountMicroUsdを足しても
 *   limitMicroUsd以下に収まる場合のみ加算する(収まらなければ0を足す=実質no-op)。
 *   現在値の取得と加算判定・書き込みが同一SQL文内で行われるため、同一guildへの並行
 *   リクエストでも予算超過や二重カウントが起きない。
 */
export async function reserveGuildMonthlyBudget(
  prisma: PrismaClient,
  input: { guildId: string; amountMicroUsd: number; limitMicroUsd: number; now?: Date },
): Promise<GuildMonthlyBudgetReservation> {
  const periodStart = startOfJstMonth(input.now ?? new Date());
  const amount = BigInt(Math.max(0, Math.round(input.amountMicroUsd)));
  const limit = BigInt(Math.max(0, Math.round(input.limitMicroUsd)));

  const priorSpendUsd = await getGuildMonthlyAiSpendUsd(prisma, input.guildId, periodStart).catch(
    () => 0,
  );
  const seedMicroUsd = BigInt(Math.max(0, Math.round(priorSpendUsd * 1_000_000)));

  const rows = await prisma.$queryRaw<Array<{ reservedMicroUsd: bigint; accepted: boolean }>>`
    WITH current_row AS (
      INSERT INTO "ai_guild_monthly_budget_usage" ("guild_id", "period_start", "reserved_micro_usd")
      VALUES (${input.guildId}, ${periodStart}, ${seedMicroUsd})
      ON CONFLICT ("guild_id", "period_start")
      DO UPDATE SET "reserved_micro_usd" = "ai_guild_monthly_budget_usage"."reserved_micro_usd"
      RETURNING "reserved_micro_usd"
    ),
    applied AS (
      UPDATE "ai_guild_monthly_budget_usage"
      SET "reserved_micro_usd" = "ai_guild_monthly_budget_usage"."reserved_micro_usd" +
        (CASE WHEN (SELECT "reserved_micro_usd" FROM current_row) + ${amount} <= ${limit}
          THEN ${amount} ELSE 0 END)
      WHERE "guild_id" = ${input.guildId} AND "period_start" = ${periodStart}
      RETURNING "reserved_micro_usd"
    )
    SELECT
      applied."reserved_micro_usd" AS "reservedMicroUsd",
      ((SELECT "reserved_micro_usd" FROM current_row) + ${amount} <= ${limit}) AS "accepted"
    FROM applied
  `;

  const row = rows[0];
  const reservedTotalMicroUsd = Number(row?.reservedMicroUsd ?? 0n);
  return { allowed: row?.accepted ?? false, reservedTotalMicroUsd, periodStart };
}

/**
 * reserveGuildMonthlyBudgetで確保した分を、実コストとの差分(deltaMicroUsd)で調整する。
 * 失敗時(呼び出し自体が不成立、または課金有無が不明な場合)はreserve時の全額をマイナスで
 * 渡して解放するか、呼び出さずreserveを保持したままにする(呼び出し元のポリシー次第)。
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
