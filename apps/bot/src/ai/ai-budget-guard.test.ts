import { describe, expect, it, vi } from 'vitest';
import { AiFoundationError } from '@herta/plugin-catalog/ai-service';
import type { AiRuntimeGenerationService } from './runtime-service.js';

const reserveGuildMonthlyBudgetMock = vi.fn();
const settleGuildMonthlyBudgetDeltaMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@herta/db', () => ({
  reserveGuildMonthlyBudget: (...args: unknown[]) => reserveGuildMonthlyBudgetMock(...args),
  settleGuildMonthlyBudgetDelta: (...args: unknown[]) => settleGuildMonthlyBudgetDeltaMock(...args),
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

const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');

describe('wrapWithGuildMonthlyBudgetGuard', () => {
  it('予算が0(上限なし)ならそのままinnerを返す', () => {
    const inner = { generate: vi.fn() } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 0,
      worstCaseRequestMicroUsd: 120_000,
    });
    expect(wrapped).toBe(inner);
  });

  it('予算が1リクエスト上限より小さい場合、予約額は予算額で頭打ちする', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 100_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r0', estimatedCost: 0.00005 }),
    } as unknown as AiRuntimeGenerationService;
    // 月次予算$0.10(=100,000 micro USD) < worstCaseRequestMicroUsd(既定の$0.12=120,000)。
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 0.1,
      worstCaseRequestMicroUsd: 120_000,
    });

    await wrapped.generate(baseRequest);
    expect(reserveGuildMonthlyBudgetMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ amountMicroUsd: 100_000, limitMicroUsd: 100_000 }),
    );
  });

  it('consumeRateLimitはinnerへそのまま委譲する', async () => {
    const consumeRateLimit = vi.fn().mockResolvedValue(undefined);
    const inner = { generate: vi.fn(), consumeRateLimit } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await wrapped.consumeRateLimit?.(baseRequest);
    expect(consumeRateLimit).toHaveBeenCalledWith(baseRequest);
  });

  it('reserveが許可されれば呼び出し、実コストとの差分でsettleする', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r1', estimatedCost: 0.00005 }),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    const result = await wrapped.generate(baseRequest);
    expect(result).toEqual({ requestId: 'r1', estimatedCost: 0.00005 });
    expect(reserveGuildMonthlyBudgetMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        guildId: 'guild-1',
        amountMicroUsd: 120_000,
        limitMicroUsd: 10_000_000,
      }),
    );
    // 実コスト(0.00005 USD = 50 micro USD) - worstCase(120,000) = -119,950
    expect(settleGuildMonthlyBudgetDeltaMock).toHaveBeenCalledWith(
      {},
      'guild-1',
      PERIOD_START,
      50 - 120_000,
    );
  });

  it('reserveが拒否されればquota_exceededでブロックしinnerを呼ばない', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: false,
      reserved: false,
      reservedTotalMicroUsd: 10_200_000,
      periodStart: PERIOD_START,
    });
    const inner = { generate: vi.fn() } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'quota_exceeded' }),
    );
    expect(inner.generate).not.toHaveBeenCalled();
  });

  it('provider呼び出しに到達する前の失敗(rate_limited等)はreserve分を全額解放する', async () => {
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      // AiFoundationService.generate()は、provider呼び出し前のrate_limited判定では
      // dispatched:falseを明示的に設定する。
      generate: vi
        .fn()
        .mockRejectedValue(new AiFoundationError('rate_limited', { dispatched: false })),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'rate_limited' }),
    );
    expect(settleGuildMonthlyBudgetDeltaMock).toHaveBeenCalledWith(
      {},
      'guild-1',
      PERIOD_START,
      -120_000,
    );
  });

  it('provider呼び出し前のquota_exceeded(dispatched:false)はreserve分を全額解放する', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      // 短期Redis guildQuota超過など、provider呼び出し前のquota_exceeded。
      generate: vi
        .fn()
        .mockRejectedValue(new AiFoundationError('quota_exceeded', { dispatched: false })),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'quota_exceeded' }),
    );
    expect(settleGuildMonthlyBudgetDeltaMock).toHaveBeenCalledWith(
      {},
      'guild-1',
      PERIOD_START,
      -120_000,
    );
  });

  it('provider呼び出し後(課金有無不明)の失敗はreserveを保持し解放しない(タイムアウト等)', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      generate: vi.fn().mockRejectedValue(new AiFoundationError('timeout')),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'timeout' }),
    );
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });

  it('inner.generateからのquota_exceeded(provider呼び出し後の可能性がある)もreserveを保持し解放しない', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      // AiFoundationService.generate()はprovider呼び出し・Redis settle後にも同じ
      // 'quota_exceeded'カテゴリを投げうる(perRequestCostLimitMicroUsd超過・guildQuotaMicroUsd
      // 超過)ため、カテゴリ名だけでは判別できない。常に保守的に保持する(Codexレビュー指摘)。
      generate: vi.fn().mockRejectedValue(new AiFoundationError('quota_exceeded')),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError(
      expect.objectContaining({ category: 'quota_exceeded' }),
    );
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });

  it('AiFoundationError以外の例外(ネットワーク断等)もreserveを保持し解放しない', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: true,
      reservedTotalMicroUsd: 120_000,
      periodStart: PERIOD_START,
    });
    const inner = {
      generate: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    await expect(wrapped.generate(baseRequest)).rejects.toThrowError('network down');
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });

  it('reserve自体がDB障害で失敗してもfail-openでinner.generateを呼ぶ(settleもしない)', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockRejectedValueOnce(new Error('db down'));
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r2', estimatedCost: 0 }),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    const result = await wrapped.generate(baseRequest);
    expect(result).toEqual({ requestId: 'r2', estimatedCost: 0 });
    // reserved:false(何も書き込まれていない)ため、settleは呼ばれない(Codexレビュー指摘:
    // 書き込まれていない予約を差し引くと、別の並行リクエストの予約を誤って減算してしまう)。
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });

  it('reservedがfalse(DB障害によるfail-open)ならprovider成功後もsettleしない', async () => {
    settleGuildMonthlyBudgetDeltaMock.mockClear();
    reserveGuildMonthlyBudgetMock.mockResolvedValueOnce({
      allowed: true,
      reserved: false,
      reservedTotalMicroUsd: 0,
      periodStart: PERIOD_START,
    });
    const inner = {
      generate: vi.fn().mockResolvedValue({ requestId: 'r3', estimatedCost: 0.0001 }),
    } as unknown as AiRuntimeGenerationService;
    const wrapped = wrapWithGuildMonthlyBudgetGuard(inner, {
      prisma: {} as never,
      budgetUsd: 10,
      worstCaseRequestMicroUsd: 120_000,
    });

    const result = await wrapped.generate(baseRequest);
    expect(result).toEqual({ requestId: 'r3', estimatedCost: 0.0001 });
    expect(settleGuildMonthlyBudgetDeltaMock).not.toHaveBeenCalled();
  });
});
