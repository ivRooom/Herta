import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getCommunityUserDailySeries,
  getCommunityUserMetricTotals,
} from './community-user-activity-summary.js';

test('getCommunityUserMetricTotalsはmetricごとの合計(bigint→number)をuserId絞り込みで返す', async () => {
  let capturedWhere: unknown;
  const prisma = {
    communityActivityDaily: {
      groupBy: async (args: { where: unknown }) => {
        capturedWhere = args.where;
        return [
          { metric: 'messages', _sum: { value: 10n } },
          { metric: 'voice_seconds', _sum: { value: 600n } },
        ];
      },
    },
  } as unknown as PrismaClient;

  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-31T00:00:00Z');
  const result = await getCommunityUserMetricTotals(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    start,
    end,
  });

  assert.deepEqual(result, [
    { metric: 'messages', value: 10 },
    { metric: 'voice_seconds', value: 600 },
  ]);
  assert.deepEqual(capturedWhere, {
    guildId: 'guild-1',
    userId: 'user-1',
    activityDate: { gte: start, lte: end },
  });
});

test('_sum.valueがnullの場合は0を返す', async () => {
  const prisma = {
    communityActivityDaily: {
      groupBy: async () => [{ metric: 'messages', _sum: { value: null } }],
    },
  } as unknown as PrismaClient;

  const result = await getCommunityUserMetricTotals(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    start: new Date(),
    end: new Date(),
  });

  assert.deepEqual(result, [{ metric: 'messages', value: 0 }]);
});

test('getCommunityUserDailySeriesはactivityDateごとの値をuserId・metric絞り込みで返す', async () => {
  let capturedWhere: unknown;
  const prisma = {
    communityActivityDaily: {
      groupBy: async (args: { where: unknown }) => {
        capturedWhere = args.where;
        return [
          { activityDate: new Date('2026-01-01T00:00:00Z'), _sum: { value: 3n } },
          { activityDate: new Date('2026-01-02T00:00:00Z'), _sum: { value: 5n } },
        ];
      },
    },
  } as unknown as PrismaClient;

  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-31T00:00:00Z');
  const result = await getCommunityUserDailySeries(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    metric: 'messages',
    start,
    end,
  });

  assert.deepEqual(
    result.map((item) => item.value),
    [3, 5],
  );
  assert.deepEqual(capturedWhere, {
    guildId: 'guild-1',
    userId: 'user-1',
    metric: 'messages',
    activityDate: { gte: start, lte: end },
  });
});
