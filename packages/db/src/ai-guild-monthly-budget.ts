import type { Prisma, PrismaClient } from '@prisma/client';
import { getGuildMonthlyAiSpendUsd, startOfJstMonth } from './ai-generation-analytics.js';

export interface GuildMonthlyBudgetReservation {
  allowed: boolean;
  reservedTotalMicroUsd: number;
  periodStart: Date;
}

type TxClient = Prisma.TransactionClient;

/**
 * Guild単位の月次AI予算(Issue #519)をatomicにreserveする。
 *
 * 当初はCTEを1本のSQL文にまとめる形で実装したが、PostgreSQLのデータ変更CTEは文の開始時点の
 * 単一スナップショットを共有するため、「行を新規作成するCTE」と「その行を更新する別のCTE」を
 * 同じ文に書いても後者から前者の変更が見えず、新規guildの初回リクエストが誤って拒否される
 * バグがあった(Codexレビュー指摘)。
 *
 * 正しい実装として、`prisma.$transaction`+`SELECT ... FOR UPDATE`による明示的な行ロックを使う。
 * 1) まず`FOR UPDATE`で既存行の有無・現在値を確認する(同一guild・同一月への並行リクエストは
 *    ここで直列化される)。
 * 2) 行が既に存在する場合はそのままそれを使う。ai_generation_events(監査ログ)の当月累計を
 *    計算するSUMクエリは、行が存在しない(=この月初めてのreserve)場合にのみ実行する
 *    (Codexレビュー指摘: 既存行があるたびに毎回SUMし直すと、イベント数の増加に対して
 *    ほぼ二乗オーダーの走査コストと追加レイテンシが積み重なる)。
 * 3) 行が無く、かつ履歴クエリ自体が失敗した場合は、行を作成せずfail-open(今回のリクエストは
 *    許可するが、カウンターには何も書き込まない)。ここで0をシードした行を永続化してしまうと、
 *    既存のai_generation_eventsの消費分が以降ずっと無視され、月の残り期間フルの予算を
 *    再度使い切れてしまう(Codexレビュー指摘)。次回以降のリクエストで改めてシードを試みる。
 * 4) 判定後、収まる場合のみUPDATE(または初回行作成時はINSERT)で加算してからコミットする。
 */
export async function reserveGuildMonthlyBudget(
  prisma: PrismaClient,
  input: { guildId: string; amountMicroUsd: number; limitMicroUsd: number; now?: Date },
): Promise<GuildMonthlyBudgetReservation> {
  const periodStart = startOfJstMonth(input.now ?? new Date());
  const amount = BigInt(Math.max(0, Math.round(input.amountMicroUsd)));
  const limit = BigInt(Math.max(0, Math.round(input.limitMicroUsd)));

  return prisma.$transaction(async (tx: TxClient) => {
    let rows = await tx.$queryRaw<Array<{ reservedMicroUsd: bigint }>>`
      SELECT "reserved_micro_usd" AS "reservedMicroUsd"
      FROM "ai_guild_monthly_budget_usage"
      WHERE "guild_id" = ${input.guildId} AND "period_start" = ${periodStart}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      // SELECT ... FOR UPDATEは行が0件だと何もロックしないため、ここで初めて別の並行
      // トランザクションと競合しうる。ai_generation_eventsからシードした値でINSERT
      // ON CONFLICT DO NOTHINGし、再度FOR UPDATEで読み直すことで、先にINSERTした側の
      // 値を正として両トランザクションが一致した現在値を見るようにする。
      let priorSpendUsd: number;
      try {
        priorSpendUsd = await getGuildMonthlyAiSpendUsd(prisma, input.guildId, periodStart);
      } catch {
        // fail-open: 行を作らずこのリクエストだけ許可する。次回のreserveで再度シードを試みる。
        return { allowed: true, reservedTotalMicroUsd: 0, periodStart };
      }
      const seedMicroUsd = BigInt(Math.max(0, Math.round(priorSpendUsd * 1_000_000)));
      await tx.$executeRaw`
        INSERT INTO "ai_guild_monthly_budget_usage" ("guild_id", "period_start", "reserved_micro_usd")
        VALUES (${input.guildId}, ${periodStart}, ${seedMicroUsd})
        ON CONFLICT ("guild_id", "period_start") DO NOTHING
      `;
      rows = await tx.$queryRaw<Array<{ reservedMicroUsd: bigint }>>`
        SELECT "reserved_micro_usd" AS "reservedMicroUsd"
        FROM "ai_guild_monthly_budget_usage"
        WHERE "guild_id" = ${input.guildId} AND "period_start" = ${periodStart}
        FOR UPDATE
      `;
    }

    const current = rows[0]?.reservedMicroUsd ?? 0n;
    const allowed = current + amount <= limit;

    if (allowed) {
      await tx.$executeRaw`
        UPDATE "ai_guild_monthly_budget_usage"
        SET "reserved_micro_usd" = "reserved_micro_usd" + ${amount}
        WHERE "guild_id" = ${input.guildId} AND "period_start" = ${periodStart}
      `;
    }

    return {
      allowed,
      reservedTotalMicroUsd: Number(allowed ? current + amount : current),
      periodStart,
    };
  });
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
