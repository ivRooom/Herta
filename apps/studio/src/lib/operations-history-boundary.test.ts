import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeOperationsHistory, type OperationsSnapshot } from './operations-history.ts';

function snapshot(at: string, status: string): OperationsSnapshot {
  return {
    status,
    databaseLatencyMs: null,
    redisLatencyMs: null,
    workerLatencyMs: null,
    checkedAt: new Date(at),
  };
}

const start = new Date('2026-08-08T00:00:00.000Z');
const end = new Date('2026-08-08T00:20:00.000Z');

test('期間前から継続する障害は新規Incidentに数えない', () => {
  const result = summarizeOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z', 'outage')],
    start,
    end,
    'outage',
  );

  assert.equal(result.incidentCount, 0);
});

test('期間直前が正常なら最初の障害を新規Incidentに数える', () => {
  const result = summarizeOperationsHistory(
    [snapshot('2026-08-08T00:00:00.000Z', 'outage')],
    start,
    end,
    'operational',
  );

  assert.equal(result.incidentCount, 1);
});

test('継続障害が復旧した後の再障害だけを新規Incidentに数える', () => {
  const result = summarizeOperationsHistory(
    [
      snapshot('2026-08-08T00:00:00.000Z', 'outage'),
      snapshot('2026-08-08T00:05:00.000Z', 'operational'),
      snapshot('2026-08-08T00:10:00.000Z', 'degraded'),
    ],
    start,
    end,
    'outage',
  );

  assert.equal(result.incidentCount, 1);
});
