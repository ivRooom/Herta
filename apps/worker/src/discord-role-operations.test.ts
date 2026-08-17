import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRoleDeleteRetryAt,
  normalizeRoleOperationScanIntervalSeconds,
} from './discord-role-operations.ts';

test('Role Operation scan intervalを5〜300秒へ制限する', () => {
  assert.equal(normalizeRoleOperationScanIntervalSeconds(undefined), 15);
  assert.equal(normalizeRoleOperationScanIntervalSeconds(1), 5);
  assert.equal(normalizeRoleOperationScanIntervalSeconds(30), 30);
  assert.equal(normalizeRoleOperationScanIntervalSeconds(999), 300);
});

test('delete retryはattemptに応じて指数backoffする', () => {
  const now = new Date('2026-08-17T08:00:00.000Z');
  assert.equal(computeRoleDeleteRetryAt(now, 1).toISOString(), '2026-08-17T08:00:15.000Z');
  assert.equal(computeRoleDeleteRetryAt(now, 2).toISOString(), '2026-08-17T08:00:30.000Z');
  assert.equal(computeRoleDeleteRetryAt(now, 5).toISOString(), '2026-08-17T08:04:00.000Z');
});
