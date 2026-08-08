import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getServiceHealthSnapshotRetentionCutoff,
  normalizeServiceHealthSnapshotLimit,
} from './health-snapshots.js';

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

test('Health Snapshot保持期限は指定日数分だけ過去へ移動する', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  assert.equal(
    getServiceHealthSnapshotRetentionCutoff(31, now).toISOString(),
    '2026-07-08T12:00:00.000Z',
  );
});

test('保持日数の不正値は31日、0以下は最低1日に正規化する', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  assert.equal(
    getServiceHealthSnapshotRetentionCutoff(Number.NaN, now).toISOString(),
    '2026-07-08T12:00:00.000Z',
  );
  assert.equal(
    getServiceHealthSnapshotRetentionCutoff(0, now).toISOString(),
    '2026-08-07T12:00:00.000Z',
  );
});
