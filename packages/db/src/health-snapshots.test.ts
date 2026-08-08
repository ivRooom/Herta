import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServiceHealthSnapshotLimit } from './health-snapshots.js';

test('Health Snapshot取得件数を1から50000へ制限する', () => {
  assert.equal(normalizeServiceHealthSnapshotLimit(-10), 1);
  assert.equal(normalizeServiceHealthSnapshotLimit(1.9), 1);
  assert.equal(normalizeServiceHealthSnapshotLimit(50_001), 50_000);
});

test('非有限値や未指定値は安全な既定値へ戻す', () => {
  assert.equal(normalizeServiceHealthSnapshotLimit(Number.NaN), 10_000);
  assert.equal(normalizeServiceHealthSnapshotLimit(Number.POSITIVE_INFINITY), 10_000);
  assert.equal(normalizeServiceHealthSnapshotLimit(Number.NEGATIVE_INFINITY), 10_000);
  assert.equal(normalizeServiceHealthSnapshotLimit(null), 10_000);
  assert.equal(normalizeServiceHealthSnapshotLimit(undefined), 10_000);
});
