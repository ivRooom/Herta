import type { PrismaClient } from '@herta/db';
import { reserveGuildMonthlyBudget, settleGuildMonthlyBudgetDelta } from '@herta/db';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationRequest, AiRuntimeGenerationService } from './runtime-service.js';

/**
 * provider呼び出しに到達する前に確実に失敗したか(=実コストは発生していない=reserve分を
 * 全額安全に解放できる)。'quota_exceeded'のように、AiFoundationService.generate()内で
 * provider呼び出しの前後どちらでも発生しうるカテゴリがあり、カテゴリ名だけでは判別できない
 * ため(Codexレビュー指摘)、AiFoundationErrorが持つ`dispatched`フラグ(provider呼び出しが
 * 実際に発生した可能性があるかをAiFoundationService自身が判断して設定する)を使う。
 * AiFoundationError以外の例外は、provider呼び出し中に投げられた可能性を否定できないため
 * 保守的に「解放しない」側として扱う。
 */
function isPreDispatchFailure(error: unknown): boolean {
  return error instanceof AiFoundationError && !error.dispatched;
}

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
 * worstCaseRequestMicroUsd(通常はグローバルなperRequestCostLimitMicroUsd)が月次予算自体より
 * 大きいと、reserveが常に上限超過で拒否される(例: 既定の1リクエスト上限$0.12に対し月次予算
 * $0.10を設定した場合、どんなリクエストも通らない)。これは正しい挙動として維持する
 * (Codexレビュー指摘: reserve量を予算で頭打ちして無理に通すと、実際には最大$0.12かかりうる
 * リクエストを「通る」ことにしてしまい、settle後に予算を実際に超過してしまう。見積りが
 * 予算に収まらないなら、素直に拒否するのが正しい)。
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
      }).catch(() => ({
        allowed: true,
        reserved: false,
        reservedTotalMicroUsd: 0,
        periodStart: new Date(),
      }));

      if (!reservation.allowed) {
        throw new AiFoundationError('quota_exceeded', { dispatched: false });
      }

      try {
        const response = await inner.generate(request);
        const actualMicroUsd = Math.round(response.estimatedCost * 1_000_000);
        // reserved:falseの場合は何も書き込まれていない(DB障害によるfail-open)ため、
        // settleすると別の並行リクエストが作った行や既存の消費分を誤って減算してしまう
        // (Codexレビュー指摘)。
        if (reservation.reserved) {
          await settleGuildMonthlyBudgetDelta(
            options.prisma,
            request.guildId,
            reservation.periodStart,
            actualMicroUsd - options.worstCaseRequestMicroUsd,
          ).catch(() => undefined);
        }
        return response;
      } catch (error) {
        // provider呼び出しに到達する前の失敗だけ、reserve分を全額解放する(実コストが
        // 発生しようがないと断定できるケースのみ)。それ以外は保守的にreserveを保持する。
        if (reservation.reserved && isPreDispatchFailure(error)) {
          await settleGuildMonthlyBudgetDelta(
            options.prisma,
            request.guildId,
            reservation.periodStart,
            -options.worstCaseRequestMicroUsd,
          ).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}
