import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  reserveGuildMonthlyBudget,
  settleGuildMonthlyBudgetDelta,
} from './ai-guild-monthly-budget.js';

function fakePrisma(options: {
  reservedMicroUsd: bigint;
  accepted: boolean;
  priorSpendUsd?: number;
}): { prisma: PrismaClient; queryRawCalls: unknown[][] } {
  const queryRawCalls: unknown[][] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      queryRawCalls.push([sql, ...values]);
      // getGuildMonthlyAiSpendUsd(ai-generation-analytics.ts)が呼ぶクエリはSELECT文、
      // reserveGuildMonthlyBudget自身のクエリはWITH句で始まる。SQLの先頭で判別する。
      if (sql.trim().startsWith('SELECT')) {
        return [{ spentUsd: options.priorSpendUsd ?? 0 }];
      }
      return [{ reservedMicroUsd: options.reservedMicroUsd, accepted: options.accepted }];
    },
    $executeRaw: async () => 1,
  } as unknown as PrismaClient;
  return { prisma, queryRawCalls };
}

test('reserveが許可されればallowed:trueと加算後の合計を返す', async () => {
  const { prisma } = fakePrisma({ reservedMicroUsd: 200_000n, accepted: true });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 1_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reservedTotalMicroUsd, 200_000);
});

test('reserveが拒否されればallowed:falseを返す(テーブルへの書き込みは1文のみ)', async () => {
  const { prisma, queryRawCalls } = fakePrisma({ reservedMicroUsd: 900_000n, accepted: false });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 200_000,
    limitMicroUsd: 1_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reservedTotalMicroUsd, 900_000);
  // getGuildMonthlyAiSpendUsd(SELECT)とreserve本体(WITH句)の2クエリのみで、
  // 判定と書き込みが別文に分かれる差し戻しクエリは発生しない(atomicな1文で完結する)。
  assert.equal(queryRawCalls.length, 2);
});

test('reserveはai_generation_eventsの当月既存消費分を初回行作成時のシード値として使う', async () => {
  const { prisma, queryRawCalls } = fakePrisma({
    reservedMicroUsd: 5_100_000n,
    accepted: true,
    priorSpendUsd: 5,
  });

  await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 10_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  const reserveCall = queryRawCalls.find(([sql]) => String(sql).trim().startsWith('WITH'));
  assert.ok(reserveCall);
  // priorSpendUsd(5 USD) * 1_000_000 = 5,000,000 micro USDがシード値として渡っている。
  assert.ok(reserveCall?.includes(5_000_000n));
});

test('settleGuildMonthlyBudgetDeltaはdelta=0なら何もしない', async () => {
  let executed = false;
  const prisma = {
    $executeRaw: async () => {
      executed = true;
      return 1;
    },
  } as unknown as PrismaClient;

  await settleGuildMonthlyBudgetDelta(prisma, 'guild-1', new Date(), 0);

  assert.equal(executed, false);
});
