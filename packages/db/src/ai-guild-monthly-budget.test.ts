import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  reserveGuildMonthlyBudget,
  settleGuildMonthlyBudgetDelta,
} from './ai-guild-monthly-budget.js';

function fakePrisma(reservedMicroUsdAfterInsert: bigint): {
  prisma: PrismaClient;
  queryRawCalls: unknown[][];
  executeRawCalls: unknown[][];
} {
  const queryRawCalls: unknown[][] = [];
  const executeRawCalls: unknown[][] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queryRawCalls.push([strings.join('?'), ...values]);
      return [{ reservedMicroUsd: reservedMicroUsdAfterInsert }];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeRawCalls.push([strings.join('?'), ...values]);
      return 1;
    },
  } as unknown as PrismaClient;
  return { prisma, queryRawCalls, executeRawCalls };
}

test('予約後の累計が上限以下ならallowed:trueを返す', async () => {
  const { prisma, executeRawCalls } = fakePrisma(100_000n);

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 1_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reservedTotalMicroUsd, 100_000);
  // 上限内なので差し戻しのUPDATEは発生しない。
  assert.equal(executeRawCalls.length, 0);
});

test('予約後の累計が上限を超えたらallowed:falseを返し、この呼び出し分を差し戻す', async () => {
  const { prisma, executeRawCalls } = fakePrisma(1_200_000n);

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 200_000,
    limitMicroUsd: 1_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reservedTotalMicroUsd, 1_000_000);
  assert.equal(executeRawCalls.length, 1);
  // 差し戻し分(-200,000)がUPDATEに渡っていることを確認する。
  assert.ok(executeRawCalls[0]?.includes(-200_000n));
});

test('settleGuildMonthlyBudgetDeltaはdelta=0なら何もしない', async () => {
  const { prisma, executeRawCalls } = fakePrisma(0n);

  await settleGuildMonthlyBudgetDelta(prisma, 'guild-1', new Date(), 0);

  assert.equal(executeRawCalls.length, 0);
});
