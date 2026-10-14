import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getCommunityUserGameBreakdown } from './community-user-game-breakdown.js';

test('指定userのゲーム別プレイ時間合計(bigint→number)をuserId絞り込みで返す', async () => {
  let capturedWhere: unknown;
  let capturedTake: unknown;
  const prisma = {
    communityGameActivityDaily: {
      groupBy: async (args: { where: unknown; take: unknown }) => {
        capturedWhere = args.where;
        capturedTake = args.take;
        return [
          { activityName: 'Minecraft', _sum: { value: 3600n } },
          { activityName: 'VALORANT', _sum: { value: 1800n } },
        ];
      },
    },
  } as unknown as PrismaClient;

  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-31T00:00:00Z');
  const result = await getCommunityUserGameBreakdown(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    start,
    end,
  });

  assert.deepEqual(result, [
    { activityName: 'Minecraft', value: 3600 },
    { activityName: 'VALORANT', value: 1800 },
  ]);
  assert.deepEqual(capturedWhere, {
    guildId: 'guild-1',
    userId: 'user-1',
    activityDate: { gte: start, lte: end },
  });
  assert.equal(capturedTake, 10);
});

test('limitは1〜25の範囲へclampする', async () => {
  let capturedTake: unknown;
  const prisma = {
    communityGameActivityDaily: {
      groupBy: async (args: { take: unknown }) => {
        capturedTake = args.take;
        return [];
      },
    },
  } as unknown as PrismaClient;

  await getCommunityUserGameBreakdown(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    start: new Date(),
    end: new Date(),
    limit: 999,
  });

  assert.equal(capturedTake, 25);
});
