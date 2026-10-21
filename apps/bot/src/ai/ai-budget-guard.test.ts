import { describe, expect, it, vi } from 'vitest';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const getGuildMonthlyAiSpendUsdMock = vi.fn();

vi.mock('@herta/db', () => ({
  getGuildMonthlyAiSpendUsd: (...args: unknown[]) => getGuildMonthlyAiSpendUsdMock(...args),
}));

const { wrapWithGuildMonthlyBudgetGuard } = await import('./ai-budget-guard.js');

const baseRequest = {
  feature: 'chat',
  input: 'hello',
  guildId: 'guild-1',
  scopeGuildId: 'guild-1',
  userId: 'user-1',
  authorized: true,
  pluginEnabled: true,
  guildOptIn: true,
};

describe('wrapWithGuildMonthlyBudgetGuard', () => {
  it('予算が0(上限なし)ならそのままinnerを返す', () => {
    const inner = { generate: vi.fn() } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 0,
    });
    expect(wrapped).toBe(inner);
  });

  it('consumeRateLimitはinnerへそのまま委譲する', async () => {
    const consumeRateLimit = vi.fn().mockResolvedValue(undefined);
    const inner = { generate: vi.fn(), consumeRateLimit } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
    });

    await wrapped.consumeRateLimit?.(baseRequest);
    expect(consumeRateLimit).toHaveBeenCalledWith(baseRequest);
  });

  it('月次支出が予算未満ならinner.generateへ委譲する', async () => {
    getGuildMonthlyAiSpendUsdMock.mockResolvedValueOnce(5);
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r1' }),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, { prisma: {} as never, budgetUsd: 10 });

    const result = await wrapped.generate(baseRequest);
    expect(result).toEqual({ requestId: 'r1' });
    expect(inner.generate).toHaveBeenCalledWith(baseRequest);
  });

  it('月次支出が予算以上ならquota_exceededでブロックしinnerを呼ばない', async () => {
    getGuildMonthlyAiSpendUsdMock.mockResolvedValueOnce(10);
    const inner = { generate: vi.fn() } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, { prisma: {} as never, budgetUsd: 10 });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'quota_exceeded' }),
    );
    expect(inner.generate).not.toHaveBeenCalled();
  });

  it('DB照会が失敗してもinner.generateを呼ぶ(fail-open)', async () => {
    getGuildMonthlyAiSpendUsdMock.mockRejectedValueOnce(new Error('db down'));
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r2' }),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, { prisma: {} as never, budgetUsd: 10 });

    const result = await wrapped.generate(baseRequest);
    expect(result).toEqual({ requestId: 'r2' });
  });
});
