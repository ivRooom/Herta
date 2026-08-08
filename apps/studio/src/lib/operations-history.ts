export type OperationsRangeKey = '24h' | '7d' | '30d';

export interface OperationsSnapshot {
  status: string;
  databaseLatencyMs: number | null;
  redisLatencyMs: number | null;
  workerLatencyMs: number | null;
  checkedAt: Date;
}

export interface OperationsHistoryBucket {
  checkedAt: Date;
  firstSampleAt: Date;
  lastSampleAt: Date;
  hasCollectionGap: boolean;
  availabilityPercent: number;
  databaseLatencyMs: number | null;
  redisLatencyMs: number | null;
  workerLatencyMs: number | null;
  worstStatus: string;
  samples: number;
}

export interface OperationsHistorySummary {
  availabilityPercent: number | null;
  coveragePercent: number;
  incidentCount: number;
  nonOperationalMinutes: number;
  collectionGapMinutes: number;
  databaseLatencyMs: number | null;
  redisLatencyMs: number | null;
  workerLatencyMs: number | null;
}

export const HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS = 5 * 60 * 1_000;

export const OPERATIONS_RANGE_CONFIG: Record<
  OperationsRangeKey,
  { label: string; durationMs: number; bucketMs: number }
> = {
  '24h': { label: '24時間', durationMs: 24 * 60 * 60 * 1_000, bucketMs: 5 * 60 * 1_000 },
  '7d': { label: '7日', durationMs: 7 * 24 * 60 * 60 * 1_000, bucketMs: 30 * 60 * 1_000 },
  '30d': { label: '30日', durationMs: 30 * 24 * 60 * 60 * 1_000, bucketMs: 2 * 60 * 60 * 1_000 },
};

const STATUS_RANK: Record<string, number> = {
  operational: 0,
  maintenance: 1,
  unknown: 2,
  degraded: 3,
  outage: 4,
};

export function resolveOperationsRange(value: string | undefined): OperationsRangeKey {
  return value === '7d' || value === '30d' ? value : '24h';
}

export function bucketOperationsHistory(
  snapshots: OperationsSnapshot[],
  bucketMs: number,
): OperationsHistoryBucket[] {
  if (snapshots.length === 0 || bucketMs <= 0) return [];

  const buckets = new Map<
    number,
    {
      samples: number;
      operational: number;
      database: number[];
      redis: number[];
      worker: number[];
      sampleTimes: number[];
      worstStatus: string;
    }
  >();

  for (const snapshot of snapshots) {
    const sampleTime = snapshot.checkedAt.getTime();
    const key = Math.floor(sampleTime / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? {
      samples: 0,
      operational: 0,
      database: [],
      redis: [],
      worker: [],
      sampleTimes: [],
      worstStatus: 'operational',
    };
    bucket.samples += 1;
    bucket.sampleTimes.push(sampleTime);
    if (snapshot.status === 'operational') bucket.operational += 1;
    pushFinite(bucket.database, snapshot.databaseLatencyMs);
    pushFinite(bucket.redis, snapshot.redisLatencyMs);
    pushFinite(bucket.worker, snapshot.workerLatencyMs);
    if (statusRank(snapshot.status) > statusRank(bucket.worstStatus)) {
      bucket.worstStatus = snapshot.status;
    }
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([checkedAt, bucket]) => {
      const sampleTimes = [...bucket.sampleTimes].sort((a, b) => a - b);
      const firstSampleTime = sampleTimes[0] ?? checkedAt;
      const lastSampleTime = sampleTimes[sampleTimes.length - 1] ?? checkedAt;
      return {
        checkedAt: new Date(checkedAt),
        firstSampleAt: new Date(firstSampleTime),
        lastSampleAt: new Date(lastSampleTime),
        hasCollectionGap: hasInternalCollectionGap(sampleTimes),
        availabilityPercent: roundPercent((bucket.operational / bucket.samples) * 100),
        databaseLatencyMs: average(bucket.database),
        redisLatencyMs: average(bucket.redis),
        workerLatencyMs: average(bucket.worker),
        worstStatus: bucket.worstStatus,
        samples: bucket.samples,
      };
    });
}

export function hasOperationsHistoryGap(
  previous: OperationsHistoryBucket | undefined,
  current: OperationsHistoryBucket,
): boolean {
  if (current.hasCollectionGap) return true;
  if (!previous) return false;
  return (
    current.firstSampleAt.getTime() - previous.lastSampleAt.getTime() >
    HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS * 2
  );
}

export function summarizeOperationsHistory(
  snapshots: OperationsSnapshot[],
  rangeStart: Date,
  rangeEnd: Date,
): OperationsHistorySummary {
  const ordered = [...snapshots].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
  const rangeMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
  const expectedSamples = Math.max(1, Math.ceil(rangeMs / HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS));
  const coveragePercent = roundPercent(Math.min(100, (ordered.length / expectedSamples) * 100));

  let incidentCount = 0;
  let inIncident = false;
  let nonOperationalMs = 0;
  let collectionGapMs = ordered.length === 0 ? gapBeyondExpected(rangeMs) : 0;

  if (ordered.length > 0) {
    collectionGapMs += gapBeyondExpected(
      Math.max(0, ordered[0]!.checkedAt.getTime() - rangeStart.getTime()),
    );
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const isOperational = current.status === 'operational';
    if (!isOperational && !inIncident) incidentCount += 1;
    inIncident = !isOperational;

    const nextTime = Math.min(
      ordered[index + 1]?.checkedAt.getTime() ?? rangeEnd.getTime(),
      rangeEnd.getTime(),
    );
    const elapsed = Math.max(0, nextTime - current.checkedAt.getTime());
    const represented = Math.min(elapsed, HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS * 2);
    if (!isOperational) nonOperationalMs += represented;
    collectionGapMs += gapBeyondExpected(elapsed);
  }

  const operationalSamples = ordered.filter((snapshot) => snapshot.status === 'operational').length;
  const database = ordered.flatMap((snapshot) => finiteValue(snapshot.databaseLatencyMs));
  const redis = ordered.flatMap((snapshot) => finiteValue(snapshot.redisLatencyMs));
  const worker = ordered.flatMap((snapshot) => finiteValue(snapshot.workerLatencyMs));

  return {
    availabilityPercent:
      ordered.length > 0 ? roundPercent((operationalSamples / ordered.length) * 100) : null,
    coveragePercent,
    incidentCount,
    nonOperationalMinutes: Math.round(nonOperationalMs / 60_000),
    collectionGapMinutes: Math.round(collectionGapMs / 60_000),
    databaseLatencyMs: average(database),
    redisLatencyMs: average(redis),
    workerLatencyMs: average(worker),
  };
}

function hasInternalCollectionGap(sampleTimes: number[]): boolean {
  for (let index = 1; index < sampleTimes.length; index += 1) {
    if (sampleTimes[index]! - sampleTimes[index - 1]! > HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS * 2) {
      return true;
    }
  }
  return false;
}

function gapBeyondExpected(elapsedMs: number): number {
  if (elapsedMs <= HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS * 2) return 0;
  return elapsedMs - HEALTH_SNAPSHOT_EXPECTED_INTERVAL_MS;
}

function pushFinite(target: number[], value: number | null): void {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) target.push(value);
}

function finiteValue(value: number | null): number[] {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [value] : [];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? STATUS_RANK['unknown']!;
}
