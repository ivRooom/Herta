import assert from 'node:assert/strict';
import test from 'node:test';
import { communityProfilePeriodStart } from './community-profile.js';

const now = new Date('2026-08-12T02:30:00.000Z'); // 2026-08-12 11:30 JST

test('Community Profileの7日集計はJST当日を含む7日間にする', () => {
  assert.equal(communityProfilePeriodStart('7d', now).toISOString(), '2026-08-06T00:00:00.000Z');
});

test('Community Profileの30日集計はJST当日を含む30日間にする', () => {
  assert.equal(communityProfilePeriodStart('30d', now).toISOString(), '2026-07-14T00:00:00.000Z');
});

test('Community Profileのallは全期間を返す', () => {
  assert.equal(communityProfilePeriodStart('all', now).toISOString(), '1970-01-01T00:00:00.000Z');
});
