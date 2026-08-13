import assert from 'node:assert/strict';
import test from 'node:test';
import {
  communityActivityPeriodStart,
  communityLeaderboardLevelForXp,
  communityTimestampPeriodStart,
  formatCommunityLeaderboardValue,
  normalizeCommunityLeaderboardQuery,
} from './community-leaderboard-core.ts';

test('Metricごとに利用可能な期間へLeaderboard queryを正規化する', () => {
  assert.deepEqual(normalizeCommunityLeaderboardQuery({ metric: 'messages', period: '30d' }), {
    metric: 'messages',
    period: '30d',
    limit: 10,
  });
  assert.deepEqual(normalizeCommunityLeaderboardQuery({ metric: 'xp', period: '7d', limit: 25 }), {
    metric: 'xp',
    period: 'all',
    limit: 25,
  });
  assert.deepEqual(normalizeCommunityLeaderboardQuery({ metric: 'season', period: 'all' }), {
    metric: 'season',
    period: 'season',
    limit: 10,
  });
});

test('未知Metricと不正limitは安全な既定値へ戻す', () => {
  assert.deepEqual(
    normalizeCommunityLeaderboardQuery({ metric: 'unknown', period: '30d', limit: 99 }),
    {
      metric: 'xp',
      period: 'all',
      limit: 10,
    },
  );
});

test('XPからLevelを既存XP式と同じルールで算出する', () => {
  assert.equal(communityLeaderboardLevelForXp(0), 0);
  assert.equal(communityLeaderboardLevelForXp(99), 0);
  assert.equal(communityLeaderboardLevelForXp(100), 1);
  assert.equal(communityLeaderboardLevelForXp(900), 3);
});

test('時間系Metricを読みやすい時間表記へ変換する', () => {
  assert.equal(formatCommunityLeaderboardValue('voice', 59), '0分');
  assert.equal(formatCommunityLeaderboardValue('voice', 3_600), '1時間');
  assert.equal(formatCommunityLeaderboardValue('minecraft', 5_460), '1時間 31分');
  assert.equal(formatCommunityLeaderboardValue('level', 8, 7_350), 'Lv.8 · 7,350 XP');
});

test('活動日とTimestampでJST期間境界を正しく使い分ける', () => {
  const now = new Date('2026-08-13T01:00:00.000Z');
  assert.equal(communityActivityPeriodStart('7d', now).toISOString(), '2026-08-07T00:00:00.000Z');
  assert.equal(communityTimestampPeriodStart('7d', now).toISOString(), '2026-08-06T15:00:00.000Z');
});

test('All TimeはActivityとTimestampの両方で共通の下限を返す', () => {
  const now = new Date('2026-08-13T01:00:00.000Z');
  assert.equal(communityActivityPeriodStart('all', now).toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(communityTimestampPeriodStart('all', now).toISOString(), '1970-01-01T00:00:00.000Z');
});
