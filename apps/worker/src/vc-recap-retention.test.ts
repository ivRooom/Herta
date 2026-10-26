import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@herta/db';
import type { Logger } from 'pino';
import { startVcRecapRetentionRuntime } from './vc-recap-retention.js';

function createLogger() {
  const info: unknown[][] = [];
  const error: unknown[][] = [];
  const logger = {
    info: (...args: unknown[]) => info.push(args),
    error: (...args: unknown[]) => error.push(args),
  } as unknown as Logger;
  return { logger, info, error };
}

test('起動時に保持期間切れの本文を削除し、削除件数をログに残す', async () => {
  const { logger, info } = createLogger();
  let calls = 0;
  const runtime = await startVcRecapRetentionRuntime({
    prisma: {} as PrismaClient,
    logger,
    intervalMs: 60_000,
    purge: async () => {
      calls += 1;
      return 3;
    },
  });
  await runtime.close();

  assert.equal(calls, 1);
  assert.deepEqual(info[0]?.[0], { deleted: 3 });
});

test('削除に失敗してもworkerを止めずにエラーをログに残す', async () => {
  const { logger, error } = createLogger();
  const runtime = await startVcRecapRetentionRuntime({
    prisma: {} as PrismaClient,
    logger,
    intervalMs: 60_000,
    purge: async () => {
      throw new TypeError('db down');
    },
  });
  await runtime.close();

  assert.deepEqual(error[0]?.[0], { errorName: 'TypeError' });
});
