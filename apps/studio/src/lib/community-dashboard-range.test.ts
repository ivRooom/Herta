import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCommunityCommandRange,
  resolveCommunityCommandRangeWindow,
} from './community-dashboard-range.ts';

test('normalizeCommunityCommandRangeは許可済み期間だけ受理する', () => {
  assert.equal(normalizeCommunityCommandRange('24h'), '24h');
  assert.equal(normalizeCommunityCommandRange('7d'), '7d');
  assert.equal(normalizeCommunityCommandRange('30d'), '30d');
});

test('normalizeCommunityCommandRangeは未指定・不正値・arrayを安全に7dへ正規化する', () => {
  assert.equal(normalizeCommunityCommandRange(undefined), '7d');
  assert.equal(normalizeCommunityCommandRange('90d'), '7d');
  assert.equal(normalizeCommunityCommandRange([]), '7d');
  assert.equal(normalizeCommunityCommandRange(['30d', '24h']), '30d');
  assert.equal(normalizeCommunityCommandRange(['invalid', '24h']), '7d');
});

test('24hは現在時刻からrolling 24時間を返す', () => {
  const now = new Date('2026-08-18T12:34:56.000Z');
  const window = resolveCommunityCommandRangeWindow('24h', now);

  assert.equal(window.startAt.toISOString(), '2026-08-17T12:34:56.000Z');
  assert.equal(window.chartDays, 2);
  assert.equal(window.label, '過去24時間');
});

test('7dはJST当日を含む7暦日を返す', () => {
  const now = new Date('2026-08-18T12:34:56.000Z');
  const window = resolveCommunityCommandRangeWindow('7d', now);

  assert.equal(window.startAt.toISOString(), '2026-08-11T15:00:00.000Z');
  assert.equal(window.chartDays, 7);
  assert.equal(window.label, '直近7日');
});

test('30dはJST当日を含む30暦日へ制限する', () => {
  const now = new Date('2026-08-18T12:34:56.000Z');
  const window = resolveCommunityCommandRangeWindow('30d', now);

  assert.equal(window.startAt.toISOString(), '2026-07-19T15:00:00.000Z');
  assert.equal(window.chartDays, 30);
  assert.equal(window.label, '直近30日');
});
