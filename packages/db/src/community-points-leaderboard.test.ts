import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getAllCommunityPointsEntries,
  getCommunityPointsLeaderboard,
  getCommunityUserPointsBreakdown,
} from './community-points-leaderboard.js';

const rates = {
  messagePointsPerMessage: 1,
  reactionPointsPerReaction: 1,
  voicePointsPer10Minutes: 1,
  onlinePointsPerHour: 1,
  onlinePointsDailyCap: 100,
  gamePointsPerHour: 1,
  gamePointsDailyCap: 100,
  achievementPoints: 10,
  commandPointsPerUse: 1,
  commandPointsDailyCap: 100,
  lfgPointsPerJoin: 1,
  lfgPointsDailyCap: 100,
  teamSplitPointsPerJoin: 1,
  teamSplitPointsDailyCap: 100,
  pollPointsPerVote: 1,
  pollPointsDailyCap: 100,
};

test('ソース別のポイント内訳(bigint→number)を降順で返す', async () => {
  let capturedSql = '';
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedSql = strings.join('?');
      assert.ok(values.includes('guild-1'));
      assert.ok(values.includes('user-1'));
      return [
        { source: 'messages', total: 50n },
        { source: 'game', total: 20n },
      ];
    },
  } as unknown as PrismaClient;

  const result = await getCommunityUserPointsBreakdown(prisma, {
    guildId: 'guild-1',
    userId: 'user-1',
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-01-31T00:00:00Z'),
    rates,
  });

  assert.deepEqual(result, [
    { source: 'messages', points: 50 },
    { source: 'game', points: 20 },
  ]);
  assert.match(capturedSql, /GROUP BY "source"/);
  assert.match(capturedSql, /"user_id" = /);
});

function fakePrismaWithRows(rows: Array<{ userId: string; total: bigint }>): PrismaClient {
  return {
    $queryRaw: async () => rows,
  } as unknown as PrismaClient;
}

test('getCommunityPointsLeaderboardは25人を超える候補を切り捨てる', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    userId: `user-${i}`,
    total: BigInt(30 - i),
  }));
  const prisma = fakePrismaWithRows(rows);

  const result = await getCommunityPointsLeaderboard(prisma, {
    guildId: 'guild-1',
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-01-31T00:00:00Z'),
    rates,
    limit: 100,
  });

  assert.equal(result.length, 25);
  assert.equal(result[0]?.userId, 'user-0');
});

test('getAllCommunityPointsEntriesは25人の上限を適用せず全件返す', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    userId: `user-${i}`,
    total: BigInt(30 - i),
  }));
  const prisma = fakePrismaWithRows(rows);

  const result = await getAllCommunityPointsEntries(prisma, {
    guildId: 'guild-1',
    start: new Date('2026-01-01T00:00:00Z'),
    end: new Date('2026-01-31T00:00:00Z'),
    rates,
  });

  assert.equal(result.length, 30);
  assert.deepEqual(
    result.map((r) => r.userId),
    rows.map((r) => r.userId),
  );
});
