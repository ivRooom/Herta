import type { PrismaClient } from '@herta/db';
import { reserveGuildMonthlyBudget, settleGuildMonthlyBudgetDelta } from '@herta/db';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationRequest, AiRuntimeGenerationService } from './runtime-service.js';

/**
 * 既存のRuntimeGenerationService(チャットAI本体、6プロバイダ共通のMultiProviderAiRuntimeGenerationService
 * 経由)をGuild単位の月次累積予算でラップする(Issue #519)。AiFoundationService自体はDBアクセスを
 * 持たないため、factory.ts側のこの単一ラップ箇所でのみ予算チェックを行い、6つのprovider別
 * RuntimeGenerationServiceクラスには手を入れない。
 *
 * reserve→settleのatomicパターン(既存のRedisベースguildQuotaと同じ設計思想)を使う。実コストが
 * わかる前に`worstCaseRequestMicroUsd`(既存のperRequestCostLimitMicroUsd、1 requestの最大許容
 * コスト)でreserveし、応答が返ったら実コストとの差分で調整する。読み取り→判定→書き込みを
 * 1ステップのatomic UPSERTで行うため、同一guildへの並行リクエストでも予算超過を防げる
 * (単純な「現在の消費量を読んで比較する」実装だと、並行リクエストが同じ値を読んで同時に
 * 通過してしまうレースコンディションがある)。
 *
 * 予算のreserve/settle(DB書き込み)が失敗した場合はfail-open(呼び出しを許可)する。月次予算は
 * 暴走防止の多層防御の一つであり、DB一時障害でAI機能全体を止めない方を優先する。
 */
export function wrapWithGuildMonthlyBudgetGuard(
  inner: AiRuntimeGenerationService,
  options: { prisma: PrismaClient; budgetUsd: number; worstCaseRequestMicroUsd: number },
): AiRuntimeGenerationService {
  if (options.budgetUsd <= 0) return inner;
  const limitMicroUsd = Math.round(options.budgetUsd * 1_000_000);

  return {
    consumeRateLimit: inner.consumeRateLimit?.bind(inner),
    async generate(request: AiRuntimeGenerationRequest) {
      const reservation = await reserveGuildMonthlyBudget(options.prisma, {
        guildId: request.guildId,
        amountMicroUsd: options.worstCaseRequestMicroUsd,
        limitMicroUsd,
      }).catch(() => ({ allowed: true, reservedTotalMicroUsd: 0, periodStart: new Date() }));

      if (!reservation.allowed) {
        throw new AiFoundationError('quota_exceeded');
      }

      try {
        const response = await inner.generate(request);
        const actualMicroUsd = Math.round(response.estimatedCost * 1_000_000);
        await settleGuildMonthlyBudgetDelta(
          options.prisma,
          request.guildId,
          reservation.periodStart,
          actualMicroUsd - options.worstCaseRequestMicroUsd,
        ).catch(() => undefined);
        return response;
      } catch (error) {
        // 呼び出し自体が失敗した(実コスト発生なし)ので、reserve分を全額解放する。
        await settleGuildMonthlyBudgetDelta(
          options.prisma,
          request.guildId,
          reservation.periodStart,
          -options.worstCaseRequestMicroUsd,
        ).catch(() => undefined);
        throw error;
      }
    },
  };
}
