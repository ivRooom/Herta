import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimDailyContentDeliveryAttempt } from './daily-content.js';

type ClaimPrisma = Parameters<typeof claimDailyContentDeliveryAttempt>[0];

function createClaimHarness(initial: { attemptCount: number; status: string }) {
  let attemptCount = initial.attemptCount;
  let status = initial.status;
  const queries: string[] = [];

  const prisma = {
    $queryRawUnsafe: async (query: string, ...values: unknown[]) => {
      queries.push(query);
      const [, expectedAttemptCount, maxAttempts] = values;
      const claimableStatus = ['pending', 'queued', 'retrying'].includes(status);
      if (
        typeof expectedAttemptCount !== 'number' ||
        typeof maxAttempts !== 'number' ||
        attemptCount !== expectedAttemptCount ||
        attemptCount >= maxAttempts ||
        !claimableStatus
      ) {
        return [];
      }

      status = 'processing';
      attemptCount += 1;
      return [{ attemptCount }];
    },
  } as unknown as ClaimPrisma;

  return {
    prisma,
    getAttemptCount: () => attemptCount,
    getStatus: () => status,
    getQueries: () => queries,
  };
}

test('同じattemptCountを複数workerがclaimしても1回だけ成功する', async () => {
  const harness = createClaimHarness({ attemptCount: 0, status: 'queued' });
  const startedAt = new Date('2030-01-01T00:00:00Z');

  const first = await claimDailyContentDeliveryAttempt(harness.prisma, {
    deliveryId: 'delivery-1',
    expectedAttemptCount: 0,
    maxAttempts: 1,
    startedAt,
  });
  const second = await claimDailyContentDeliveryAttempt(harness.prisma, {
    deliveryId: 'delivery-1',
    expectedAttemptCount: 0,
    maxAttempts: 1,
    startedAt,
  });

  assert.equal(first, 1);
  assert.equal(second, null);
  assert.equal(harness.getAttemptCount(), 1);
  assert.equal(harness.getStatus(), 'processing');
});

test('processing中のstalled replacementは残りbudgetがあってもclaimできない', async () => {
  const harness = createClaimHarness({ attemptCount: 1, status: 'processing' });

  const claimed = await claimDailyContentDeliveryAttempt(harness.prisma, {
    deliveryId: 'delivery-1',
    expectedAttemptCount: 1,
    maxAttempts: 5,
  });

  assert.equal(claimed, null);
  assert.equal(harness.getAttemptCount(), 1);
  assert.equal(harness.getStatus(), 'processing');
});

test('retry budget到達済みのdeliveryはclaimせずattemptCountを増やさない', async () => {
  const harness = createClaimHarness({ attemptCount: 2, status: 'retrying' });

  const claimed = await claimDailyContentDeliveryAttempt(harness.prisma, {
    deliveryId: 'delivery-1',
    expectedAttemptCount: 2,
    maxAttempts: 2,
  });

  assert.equal(claimed, null);
  assert.equal(harness.getAttemptCount(), 2);
  assert.equal(harness.getStatus(), 'retrying');
});

test('claim SQLはattemptCount・maxAttempts・claim可能statusを同じUPDATE条件で検証する', async () => {
  const harness = createClaimHarness({ attemptCount: 0, status: 'pending' });

  await claimDailyContentDeliveryAttempt(harness.prisma, {
    deliveryId: 'delivery-1',
    expectedAttemptCount: 0,
    maxAttempts: 3,
  });

  const query = harness.getQueries()[0] ?? '';
  assert.match(query, /UPDATE daily_content_deliveries/);
  assert.match(query, /attempt_count = \$2/);
  assert.match(query, /attempt_count < \$3/);
  assert.match(query, /status IN \('pending', 'queued', 'retrying'\)/);
  assert.match(query, /RETURNING attempt_count AS "attemptCount"/);
});
