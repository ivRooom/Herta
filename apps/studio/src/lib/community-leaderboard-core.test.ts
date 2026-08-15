import assert from 'node:assert/strict';
import test from 'node:test';
import {
  communityActivityPeriodStart,
  communityLeaderboardLevelForXp,
  communityLeaderboardSeasonDaysRemaining,
  communityLeaderboardSeasonStatus,
  communityTimestampPeriodStart,
  formatCommunityLeaderboardValue,
  listCommunityLeaderboardSeasons,
  normalizeCommunityLeaderboardQuery,
  resolveCommunityLeaderboardSeason,
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

test('Top 25は文字列queryでも正規化できる', () => {
  assert.deepEqual(
    normalizeCommunityLeaderboardQuery({ metric: 'messages', period: '7d', limit: '25' }),
    {
      metric: 'messages',
      period: '7d',
      limit: 25,
    },
  );
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

test('Season Pointをポイント表記で表示する', () => {
  assert.equal(formatCommunityLeaderboardValue('season', 1_250), '1,250 pt');
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

test('直近Season履歴を現在から新しい順に生成する', () => {
  const now = new Date('2026-08-15T08:56:00.000Z');
  const seasons = listCommunityLeaderboardSeasons(now, 3);

  assert.equal(listCommunityLeaderboardSeasons(now, Number.NaN).length, 6);

  assert.deepEqual(
    seasons.map((season) => ({ index: season.index, key: season.key })),
    [
      { index: 8, key: '2026-07-20' },
      { index: 7, key: '2026-06-22' },
      { index: 6, key: '2026-05-25' },
    ],
  );
});

test('Season queryは直近履歴だけを許可し不正値はCurrent Seasonへ戻す', () => {
  const now = new Date('2026-08-15T08:56:00.000Z');
  assert.equal(resolveCommunityLeaderboardSeason('2026-06-22', now).index, 7);
  assert.equal(resolveCommunityLeaderboardSeason('2099-01-01', now).index, 8);
  assert.equal(resolveCommunityLeaderboardSeason('../invalid', now).index, 8);
});

test('Seasonの状態と残り日数をJST境界で算出する', () => {
  const now = new Date('2026-08-15T08:56:00.000Z');
  const [current, previous] = listCommunityLeaderboardSeasons(now, 2);

  assert.equal(communityLeaderboardSeasonStatus(current!, now), 'current');
  assert.equal(communityLeaderboardSeasonDaysRemaining(current!, now), 2);
  assert.equal(communityLeaderboardSeasonStatus(previous!, now), 'completed');
  assert.equal(communityLeaderboardSeasonDaysRemaining(previous!, now), 0);
});
