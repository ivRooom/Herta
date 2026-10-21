import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  reserveGuildMonthlyBudget,
  settleGuildMonthlyBudgetDelta,
} from './ai-guild-monthly-budget.js';

interface FakeTx {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $queryRaw: () => Promise<Array<{ reservedMicroUsd: bigint }>>;
}

function fakePrisma(options: { existingReservedMicroUsd: bigint | null; priorSpendUsd?: number }): {
  prisma: PrismaClient;
  queryRawCalls: number;
  executeRawCalls: unknown[][];
} {
  const executeRawCalls: unknown[][] = [];
  let reserved = options.existingReservedMicroUsd;
  let queryRawCalls = 0;

  const tx: FakeTx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      executeRawCalls.push([sql, ...values]);
      if (sql.includes('INSERT INTO')) {
        if (reserved === null) reserved = values[2] as bigint;
      } else if (sql.includes('UPDATE') && sql.includes('reserved_micro_usd" + ')) {
        reserved = (reserved ?? 0n) + (values[1] as bigint);
      }
      return 1;
    },
    $queryRaw: async () => {
      queryRawCalls += 1;
      return reserved === null ? [] : [{ reservedMicroUsd: reserved }];
    },
  };

  const prisma = {
    $queryRaw: async () => {
      // getGuildMonthlyAiSpendUsd(ai-generation-analytics.ts)からの呼び出し。
      return [{ spentUsd: options.priorSpendUsd ?? 0 }];
    },
    $transaction: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;

  return {
    prisma,
    get queryRawCalls() {
      return queryRawCalls;
    },
    executeRawCalls,
  };
}

test('既存行があれば上限内なら加算してallowed:trueを返す(履歴SUMは呼ばない)', async () => {
  const { prisma, executeRawCalls } = fakePrisma({ existingReservedMicroUsd: 200_000n });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 1_000_000,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reservedTotalMicroUsd, 300_000);
  // 既存行が見つかった場合、INSERT文は一度も発行されない(=履歴SUMクエリの結果も使わない)。
  assert.equal(executeRawCalls.filter(([sql]) => String(sql).includes('INSERT')).length, 0);
});

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

test('上限を超える場合はallowed:falseを返し、テーブルへは加算しない', async () => {
  const { prisma, executeRawCalls } = fakePrisma({ existingReservedMicroUsd: 900_000n });

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 200_000,
    limitMicroUsd: 1_000_000,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reservedTotalMicroUsd, 900_000);
  assert.equal(executeRawCalls.filter(([sql]) => String(sql).includes('UPDATE')).length, 0);
});

test('既存行が無く履歴SUMクエリが失敗した場合はfail-openし行を作らない', async () => {
  const executeRawCalls: unknown[][] = [];
  const tx: FakeTx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executeRawCalls.push([strings.join('?'), ...values]);
      return 1;
    },
    $queryRaw: async () => [],
  };
  const prisma = {
    $queryRaw: async () => {
      throw new Error('db timeout');
    },
    $transaction: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;

  const result = await reserveGuildMonthlyBudget(prisma, {
    guildId: 'guild-1',
    amountMicroUsd: 100_000,
    limitMicroUsd: 1_000_000,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reservedTotalMicroUsd, 0);
  // 行を作成するINSERTは一度も発行されない。
  assert.equal(executeRawCalls.length, 0);
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
