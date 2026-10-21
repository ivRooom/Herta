import type { PrismaClient } from '@herta/db';
import { getGuildMonthlyAiSpendUsd } from '@herta/db';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationRequest, AiRuntimeGenerationService } from './runtime-service.js';

/**
 * 既存のRuntimeGenerationService(チャットAI本体、6プロバイダ共通のMultiProviderAiRuntimeGenerationService
 * 経由)をGuild単位の月次累積予算でラップする(Issue #519)。AiFoundationService自体はDBアクセスを
 * 持たないため、factory.ts側のこの単一ラップ箇所でのみ予算チェックを行い、6つのprovider別
 * RuntimeGenerationServiceクラスには手を入れない。
 *
 * 予算照会(DB読み取り)が失敗した場合はfail-open(呼び出しを許可)する。月次予算は暴走防止の
 * 多層防御の一つであり、DB一時障害でAI機能全体を止めない方を優先する。
 */
export function wrapWithGuildMonthlyBudgetGuard(
  inner: AiRuntimeGenerationService,
  options: { prisma: PrismaClient; budgetUsd: number },
): AiRuntimeGenerationService {
  if (options.budgetUsd <= 0) return inner;

  async function assertWithinBudget(guildId: string): Promise<void> {
    const spentUsd = await getGuildMonthlyAiSpendUsd(options.prisma, guildId).catch(() => 0);
    if (spentUsd >= options.budgetUsd) {
      throw new AiFoundationError('quota_exceeded');
    }
  }

  return {
    consumeRateLimit: inner.consumeRateLimit?.bind(inner),
    async generate(request: AiRuntimeGenerationRequest) {
      await assertWithinBudget(request.guildId);
      return inner.generate(request);
    },
  };
}
