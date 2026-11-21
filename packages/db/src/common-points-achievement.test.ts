import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { creditAchievementUnlockIfEnabled } from './common-points-achievement.js';
import type { CommonPointsTransaction } from './common-points-outbox.js';
import { syncAchievementUnlocks } from './achievement-unlocks.js';

test('disabled or other-guild achievement path needs no points schema or credential', async () => {
  const tx = {
    $queryRaw: async () => {
      throw new Error('must_not_query');
    },
    $executeRaw: async () => {
      throw new Error('must_not_write');
    },
  } as unknown as CommonPointsTransaction;
  await creditAchievementUnlockIfEnabled(tx, 'guild', 'user', 'achievement', new Date(), {});
  await creditAchievementUnlockIfEnabled(tx, 'guild', 'user', 'achievement', new Date(), {
    HERTA_COMMON_POINTS_ACCRUAL_ENABLED: 'true',
    HERTA_POINTS_GUILD_ID: 'other',
  });
});

test('permanent receipt prevents regrant credit without invoking mutable tariff or outbox writes', async () => {
  let reads = 0;
  const tx = {
    $queryRaw: async () => {
      reads++;
      return [{ id: 'permanent-receipt' }];
    },
    $executeRaw: async () => {
      throw new Error('must_not_write');
    },
  } as unknown as CommonPointsTransaction;
  await creditAchievementUnlockIfEnabled(tx, 'guild', 'user', 'achievement', new Date(), {
    HERTA_COMMON_POINTS_ACCRUAL_ENABLED: 'true',
    HERTA_POINTS_GUILD_ID: 'guild',
  });
  assert.equal(reads, 1);
});

test('only actual inserted unique unlocks are returned; conflicts and blocked candidates do not earn', async () => {
  let inserts = 0;
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => {
      inserts++;
      return 0;
    },
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient;
  assert.deepEqual(
    await syncAchievementUnlocks(prisma, 'guild', 'user', ['one', 'one', 'blocked:two']),
    [],
  );
  assert.equal(inserts, 1);
});
