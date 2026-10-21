import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  reserveGuildMonthlyBudget,
  settleGuildMonthlyBudgetDelta,
} from './ai-guild-monthly-budget.js';

function fakePrisma(options: { existingReservedMicroUsd: bigint | null; priorSpendUsd?: number }): {
  prisma: PrismaClient;
  executeRawCalls: unknown[][];
} {
  const executeRawCalls: unknown[][] = [];
  let reserved = options.existingReservedMicroUsd;

  interface FakeTx {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
    $queryRaw: () => Promise<Array<{ reservedMicroUsd: bigint }>>;
  }

  const tx: FakeTx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      executeRawCalls.push([sql, ...values]);
      if (sql.includes('INSERT INTO') && reserved === null) {
        // 新規行作成(DO NOTHINGなので既存行があれば何もしない)。
        reserved = values[2] as bigint;
      } else if (sql.includes('UPDATE') && sql.includes('reserved_micro_usd" + ')) {
        reserved = (reserved ?? 0n) + (values[1] as bigint);
      }
      return 1;
    },
    $queryRaw: async () => [{ reservedMicroUsd: reserved ?? 0n }],
  };

  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      // getGuildMonthlyAiSpendUsd(ai-generation-analytics.ts)からの呼び出し。
      void strings;
      void values;
      return [{ spentUsd: options.priorSpendUsd ?? 0 }];
    },
    $transaction: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;

  return { prisma, executeRawCalls };
}

test('既存行が無ければai_generation_eventsの当月消費分をシードした上でreserveする', async () => {
  const { prisma } = fakePrisma({ existingReservedMicroUsd: null, priorSpendUsd: 5 });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 10_000_000,
    now: new Date('2026-07-15T03:00:00.000Z'),
  });

  assert.equal(result.allowed, true);
  // シード5,000,000 + amount 100,000 = 5,100,000
  assert.equal(result.reservedTotalMicroUsd, 5_100_000);
});

test('既存行があれば上限内なら加算してallowed:trueを返す', async () => {
  const { prisma } = fakePrisma({ existingReservedMicroUsd: 200_000n });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 1_000_000,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reservedTotalMicroUsd, 300_000);
});

test('上限を超える場合はallowed:falseを返し、テーブルへは加算しない', async () => {
  const { prisma, executeRawCalls } = fakePrisma({ existingReservedMicroUsd: 900_000n });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 200_000,
    limitMicroUsd: 1_000_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reservedTotalMicroUsd, 900_000);
  // DO NOTHING(INSERT)のみ実行され、加算のUPDATEは発行されない。
  assert.equal(executeRawCalls.filter(([sql]) => String(sql).includes('UPDATE')).length, 0);
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
