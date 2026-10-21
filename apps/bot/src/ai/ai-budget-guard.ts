import type { PrismaClient } from '@herta/db';
import { reserveGuildMonthlyBudget, settleGuildMonthlyBudgetDelta } from '@herta/db';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationRequest, AiRuntimeGenerationService } from './runtime-service.js';

/**
 * provider呼び出し(実コスト発生の可能性がある区間)へ到達する前に確実に失敗するカテゴリ。
 * AiFoundationService.generate()はkill-switch/authorized/pluginEnabled/guildOptIn/入力検証/
 * 自前のuser・guild rate limitの判定を全てprovider呼び出しより前に行うため、これらのエラーは
 * providerへ到達していないと断定できる(=実コストは発生していない=reserve分を全額
 * 安全に解放できる)。
 *
 * 'quota_exceeded'は意図的にこの集合へ含めない。AiFoundationService.generate()は
 * reservationMicroUsdの事前チェック(provider呼び出し前)に加えて、provider呼び出し・Redisの
 * 短期guildQuota settle後にも同じ'quota_exceeded'カテゴリを投げる(estimatedCostMicroUsdが
 * perRequestCostLimitMicroUsdを超えた場合・settledTotalがguildQuotaMicroUsdを超えた場合。
 * 特にMCPツール呼び出しで2回目のprovider呼び出し分のトークンが上乗せされるとこちらに
 * 到達しやすい)。カテゴリ名だけではどちらが原因か判別できないため、Codexレビュー指摘の
 * 通り常に保守的にreserveを保持する側(=このSetに含めない)とする。
 *
 * それ以外(timeout・provider_unavailable・provider_rejected・malformed_response・
 * output_too_large・internal_error、およびAiFoundationError以外の例外)も同様に、provider
 * 呼び出しが既に発生済みで課金の有無が不明なケースを含むため、reserve分を解放せず
 * 保守的に保持する(解放すると、失敗を繰り返すことで月次予算を実質無制限に超過できて
 * しまう)。
 */
const PRE_DISPATCH_FAILURE_CATEGORIES = new Set([
  'disabled',
  'unauthorized',
  'rate_limited',
  'invalid_input',
]);

function isPreDispatchFailure(error: unknown): boolean {
  return error instanceof AiFoundationError && PRE_DISPATCH_FAILURE_CATEGORIES.has(error.category);
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
        throw new AiFoundationError('quota_exceeded');
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
