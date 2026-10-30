import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCommonPointsDelta,
  commonPointsBucketValue,
  commonPointsJstDay,
  freezeCommonPointsTariff,
} from './common-points-accrual.js';
import type { CommonPointsMetric } from './common-points-accrual.js';

const rates = {
  messagePointsPerMessage: 2,
  reactionPointsPerReaction: 1,
  voicePointsPer10Minutes: 3,
  onlinePointsPerHour: 7,
  onlinePointsDailyCap: 10,
  gamePointsPerHour: 6,
  gamePointsDailyCap: 11,
  achievementPoints: 10,
  commandPointsPerUse: 3,
  commandPointsDailyCap: 8,
  lfgPointsPerJoin: 4,
  lfgPointsDailyCap: 9,
  teamSplitPointsPerJoin: 5,
  teamSplitPointsDailyCap: 12,
  pollPointsPerVote: 2,
  pollPointsDailyCap: 5,
};

test('frozen tariff is immutable, deterministically hashed and rejects changed payload/hash', () => {
  const mutable = { ...rates };
  const frozen = freezeCommonPointsTariff(mutable);
  mutable.messagePointsPerMessage = 999;
  assert.equal(commonPointsBucketValue(frozen, 'messages', 3n), 6n);
  assert.equal(frozen.ruleVersion, freezeCommonPointsTariff({ ...rates }).ruleVersion);
  assert.throws(() => commonPointsBucketValue({ ...frozen, rates: mutable }, 'messages', 1n));
  assert.throws(() =>
    commonPointsBucketValue({ ...frozen, ruleVersion: 'a'.repeat(64) }, 'messages', 1n),
  );
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() => freezeCommonPointsTariff({ ...rates, messagePointsPerMessage: invalid }));
});

test('incremental floors/caps telescope exactly to legacy daily formulas for every eligible metric', () => {
  const frozen = freezeCommonPointsTariff(rates);
  const metrics: CommonPointsMetric[] = [
    'messages',
    'reactions_given',
    'reactions_received',
    'voice_seconds',
    'online_seconds',
    'game_seconds',
    'commands',
    'lfg_joins',
    'team_split_joins',
    'poll_votes',
    'achievement_unlocks',
  ];
  const chunks = [1n, 599n, 1n, 2399n, 600n, 3600n, 10000n];
  for (const metric of metrics) {
    let units = 0n,
      credited = 0n;
    for (const increment of chunks) {
      credited += calculateCommonPointsDelta(frozen, metric, units, units + increment);
      units += increment;
    }
    const r = rates;
    const expected: Record<CommonPointsMetric, bigint> = {
      messages: units * 2n,
      reactions_given: units,
      reactions_received: units,
      voice_seconds: (units / 600n) * 3n,
      online_seconds: BigInt(r.onlinePointsDailyCap),
      game_seconds: BigInt(r.gamePointsDailyCap),
      commands: 8n,
      lfg_joins: 9n,
      team_split_joins: 12n,
      poll_votes: 5n,
      achievement_unlocks: units * 10n,
    };
    assert.equal(credited, expected[metric], metric);
  }
});

test('baseline carries partial hour and already consumed cap; caps are points, not counts', () => {
  const tariff = freezeCommonPointsTariff(rates);
  assert.equal(calculateCommonPointsDelta(tariff, 'voice_seconds', 599n, 600n), 3n);
  assert.equal(calculateCommonPointsDelta(tariff, 'online_seconds', 3599n, 3600n), 7n);
  assert.equal(calculateCommonPointsDelta(tariff, 'online_seconds', 3600n, 7200n), 3n);
  assert.equal(calculateCommonPointsDelta(tariff, 'online_seconds', 7200n, 10800n), 0n);
  // Game names MUST share this counter, otherwise two 1800s sessions pay zero.
  assert.equal(calculateCommonPointsDelta(tariff, 'game_seconds', 1800n, 3600n), 6n);
  assert.equal(calculateCommonPointsDelta(tariff, 'commands', 2n, 3n), 2n);
  assert.equal(calculateCommonPointsDelta(tariff, 'commands', 3n, 4n), 0n);
});

test('zero rates and excluded scores never mint; invalid/decreasing counters fail closed', () => {
  const frozen = freezeCommonPointsTariff({ ...rates, onlinePointsPerHour: 0 });
  assert.equal(calculateCommonPointsDelta(frozen, 'online_seconds', 0n, 36000n), 0n);
  for (const metric of [
    'minecraft_seconds',
    'message_char_units',
    'xp',
    'season_points',
    'badge_points',
  ])
    assert.throws(() => commonPointsBucketValue(frozen, metric as CommonPointsMetric, 1n));
  assert.throws(() => calculateCommonPointsDelta(frozen, 'messages', 2n, 1n));
  assert.throws(() => commonPointsBucketValue(frozen, 'messages', -1n));
  assert.throws(() => commonPointsBucketValue(frozen, 'messages', 9_223_372_036_854_775_808n));
  assert.equal(
    commonPointsBucketValue(frozen, 'messages', 9_223_372_036_854_775_807n),
    18_446_744_073_709_551_614n,
  );
});

test('JST midnight resets day bucket independent of UTC date', () => {
  assert.equal(commonPointsJstDay(new Date('2026-10-29T14:59:59.999Z')), '2026-10-29');
  assert.equal(commonPointsJstDay(new Date('2026-10-29T15:00:00.000Z')), '2026-10-30');
  assert.throws(() => commonPointsJstDay(new Date('invalid')));
});
