import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketOperationsHistory,
  hasOperationsHistoryGap,
  resolveOperationsRange,
  summarizeOperationsHistory,
  type OperationsSnapshot,
} from './operations-history.ts';

function snapshot(
  at: string,
  status = 'operational',
  latency: { database?: number | null; redis?: number | null; worker?: number | null } = {},
): OperationsSnapshot {
  return {
    status,
    databaseLatencyMs: latency.database ?? null,
    redisLatencyMs: latency.redis ?? null,
    workerLatencyMs: latency.worker ?? null,
    checkedAt: new Date(at),
  };
}

test('rangeは24hを既定値にし7d/30dだけ許可する', () => {
  assert.equal(resolveOperationsRange(undefined), '24h');
  assert.equal(resolveOperationsRange('invalid'), '24h');
  assert.equal(resolveOperationsRange('7d'), '7d');
  assert.equal(resolveOperationsRange('30d'), '30d');
});

test('5分bucketで稼働率と平均latencyを集計する', () => {
  const result = bucketOperationsHistory(
    [
      snapshot('2026-08-08T00:01:00.000Z', 'operational', { database: 4, redis: 2 }),
      snapshot('2026-08-08T00:04:00.000Z', 'degraded', { database: 8, redis: 4 }),
      snapshot('2026-08-08T00:06:00.000Z', 'operational', { database: 6, redis: 3 }),
    ],
    5 * 60 * 1_000,
  );

  assert.equal(result.length, 2);
  assert.equal(result[0]?.availabilityPercent, 50);
  assert.equal(result[0]?.databaseLatencyMs, 6);
  assert.equal(result[0]?.redisLatencyMs, 3);
  assert.equal(result[0]?.worstStatus, 'degraded');
  assert.equal(result[1]?.availabilityPercent, 100);
});

test('集約bucket間の欠測を実Snapshot時刻から判定する', () => {
  const result = bucketOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z'), snapshot('2026-08-08T00:59:00.000Z')],
    30 * 60 * 1_000,
  );

  assert.equal(result.length, 2);
  assert.equal(result[0]?.lastSampleAt.toISOString(), '2026-08-08T00:00:00.000Z');
  assert.equal(result[1]?.firstSampleAt.toISOString(), '2026-08-08T00:59:00.000Z');
  assert.equal(hasOperationsHistoryGap(result[0], result[1]!), true);
});

test('同一集約bucket内の長時間欠測も保持する', () => {
  const result = bucketOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z'), snapshot('2026-08-08T01:59:00.000Z')],
    2 * 60 * 60 * 1_000,
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.hasCollectionGap, true);
  assert.equal(hasOperationsHistoryGap(undefined, result[0]!), true);
});

test('連続した実Snapshotは欠測扱いにしない', () => {
  const result = bucketOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z'), snapshot('2026-08-08T00:05:00.000Z')],
    5 * 60 * 1_000,
  );

  assert.equal(result.length, 2);
  assert.equal(hasOperationsHistoryGap(result[0], result[1]!), false);
});

test('10分間隔までは欠測許容し10分超で欠測扱いにする', () => {
  const tolerated = bucketOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z'), snapshot('2026-08-08T00:10:00.000Z')],
    5 * 60 * 1_000,
  );
  const missing = bucketOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z'), snapshot('2026-08-08T00:10:01.000Z')],
    5 * 60 * 1_000,
  );

  assert.equal(hasOperationsHistoryGap(tolerated[0], tolerated[1]!), false);
  assert.equal(hasOperationsHistoryGap(missing[0], missing[1]!), true);
});

test('障害遷移・非正常時間・収集gapを集計する', () => {
  const start = new Date('2026-08-08T00:00:00.000Z');
  const end = new Date('2026-08-08T01:00:00.000Z');
  const result = summarizeOperationsHistory(
    [
      snapshot('2026-08-08T00:00:00.000Z', 'operational', { database: 2 }),
      snapshot('2026-08-08T00:05:00.000Z', 'degraded', { database: 10 }),
      snapshot('2026-08-08T00:10:00.000Z', 'degraded', { database: 8 }),
      snapshot('2026-08-08T00:15:00.000Z', 'operational', { database: 4 }),
      snapshot('2026-08-08T00:40:00.000Z', 'outage', { database: null }),
      snapshot('2026-08-08T00:45:00.000Z', 'operational', { database: 6 }),
    ],
    start,
    end,
  );

  assert.equal(result.incidentCount, 2);
  assert.equal(result.nonOperationalMinutes, 15);
  assert.equal(result.collectionGapMinutes, 30);
  assert.equal(result.availabilityPercent, 50);
  assert.equal(result.databaseLatencyMs, 6);
  assert.equal(result.coveragePercent, 50);
});

test('Snapshotが0件でも選択期間全体を収集gapとして扱う', () => {
  const result = summarizeOperationsHistory(
    [],
    new Date('2026-08-08T00:00:00.000Z'),
    new Date('2026-08-08T01:00:00.000Z'),
  );

  assert.equal(result.availabilityPercent, null);
  assert.equal(result.coveragePercent, 0);
  assert.equal(result.incidentCount, 0);
  assert.equal(result.nonOperationalMinutes, 0);
  assert.equal(result.collectionGapMinutes, 55);
});

test('期間開始から最初のSnapshotまでの欠測を収集gapへ反映する', () => {
  const start = new Date('2026-08-08T00:00:00.000Z');
  const end = new Date('2026-08-08T00:20:00.000Z');
  const result = summarizeOperationsHistory(
    [snapshot('2026-08-08T00:15:00.000Z', 'operational')],
    start,
    end,
  );

  assert.equal(result.collectionGapMinutes, 10);
  assert.equal(result.nonOperationalMinutes, 0);
});

test('最後のSnapshotから期間終了までの停止も収集gapと非正常時間へ反映する', () => {
  const start = new Date('2026-08-08T00:45:00.000Z');
  const end = new Date('2026-08-08T01:05:00.000Z');
  const result = summarizeOperationsHistory(
    [
      snapshot('2026-08-08T00:45:00.000Z', 'operational'),
      snapshot('2026-08-08T00:50:00.000Z', 'outage'),
    ],
    start,
    end,
  );

  assert.equal(result.incidentCount, 1);
  assert.equal(result.nonOperationalMinutes, 10);
  assert.equal(result.collectionGapMinutes, 10);
});
