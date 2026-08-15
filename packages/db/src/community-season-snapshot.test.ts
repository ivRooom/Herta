import assert from 'node:assert/strict';
import test from 'node:test';
import { communitySeasonAwardTierForRank } from './community-season-snapshot.js';

test('Season AwardはChampion・Top3・Top10を順位から判定する', () => {
  assert.equal(communitySeasonAwardTierForRank(1), 'champion');
  assert.equal(communitySeasonAwardTierForRank(2), 'top3');
  assert.equal(communitySeasonAwardTierForRank(3), 'top3');
  assert.equal(communitySeasonAwardTierForRank(4), 'top10');
  assert.equal(communitySeasonAwardTierForRank(10), 'top10');
  assert.equal(communitySeasonAwardTierForRank(11), null);
});

test('不正な順位はSeason Awardを返さない', () => {
  assert.equal(communitySeasonAwardTierForRank(0), null);
  assert.equal(communitySeasonAwardTierForRank(-1), null);
  assert.equal(communitySeasonAwardTierForRank(1.5), null);
  assert.equal(communitySeasonAwardTierForRank(9.9), null);
  assert.equal(communitySeasonAwardTierForRank(Number.NaN), null);
  assert.equal(communitySeasonAwardTierForRank(Number.POSITIVE_INFINITY), null);
});
