import { hasOperationsHistoryGap, type OperationsHistoryBucket } from '@/lib/operations-history';

const WIDTH = 900;
const HEIGHT = 240;
const PADDING_X = 34;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 34;

export function OperationsHistoryChart({
  points,
  rangeLabel,
  rangeStart,
  rangeEnd,
}: {
  points: OperationsHistoryBucket[];
  rangeLabel: string;
  rangeStart: Date;
  rangeEnd: Date;
}) {
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">稼働履歴を収集中です</p>
        <p className="mt-2 text-xs leading-5 text-muted">
          デプロイ後から5分間隔でHealth
          Snapshotを蓄積します。履歴が増えるとここにグラフが表示されます。
        </p>
      </div>
    );
  }

  const availabilityPath = buildTimedPath(
    points,
    (point) => point.availabilityPercent,
    rangeStart,
    rangeEnd,
    0,
    100,
  );
  const latencyValues = points.flatMap((point) =>
    [point.databaseLatencyMs, point.redisLatencyMs, point.workerLatencyMs].filter(
      (value): value is number => typeof value === 'number',
    ),
  );
  const latencyMax = Math.max(10, ...latencyValues);
  const databasePath = buildTimedPath(
    points,
    (point) => point.databaseLatencyMs,
    rangeStart,
    rangeEnd,
    0,
    latencyMax,
  );
  const redisPath = buildTimedPath(
    points,
    (point) => point.redisLatencyMs,
    rangeStart,
    rangeEnd,
    0,
    latencyMax,
  );
  const workerPath = buildTimedPath(
    points,
    (point) => point.workerLatencyMs,
    rangeStart,
    rangeEnd,
    0,
    latencyMax,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">稼働率推移</h3>
            <p className="mt-1 text-xs text-muted">{rangeLabel} · Health Snapshot単位の稼働率</p>
          </div>
          <span className="text-xs text-muted">0〜100%</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-background p-3 sm:p-4">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${rangeLabel}のHerta稼働率推移。${points.length}区間を表示。欠測区間は線を分断して表示。`}
          >
            <ChartGrid maxLabel="100%" middleLabel="50%" minLabel="0%" />
            <path
              d={availabilityPath}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <TimeLabels first={rangeStart} last={rangeEnd} />
          </svg>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">依存サービスlatency</h3>
            <p className="mt-1 text-xs text-muted">DB / Redis / Worker probeの応答時間</p>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted">
            <LegendDot color="hsl(var(--primary))" label="Database" />
            <LegendDot color="hsl(var(--destructive))" label="Redis" />
            <LegendDot color="hsl(var(--muted))" label="Worker" />
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-background p-3 sm:p-4">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label={`${rangeLabel}のDatabase、Redis、Worker latency推移。最大${Math.ceil(latencyMax)}ミリ秒。欠測区間は線を分断して表示。`}
          >
            <ChartGrid
              maxLabel={`${Math.ceil(latencyMax)}ms`}
              middleLabel={`${Math.ceil(latencyMax / 2)}ms`}
              minLabel="0ms"
            />
            <path
              d={databasePath}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={redisPath}
              fill="none"
              stroke="hsl(var(--destructive))"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={workerPath}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <TimeLabels first={rangeStart} last={rangeEnd} />
          </svg>
        </div>
      </section>
    </div>
  );
}

function ChartGrid({
  maxLabel,
  middleLabel,
  minLabel,
}: {
  maxLabel: string;
  middleLabel: string;
  minLabel: string;
}) {
  const bottom = HEIGHT - PADDING_BOTTOM;
  const middle = PADDING_TOP + (bottom - PADDING_TOP) / 2;
  return (
    <>
      {[PADDING_TOP, middle, bottom].map((y) => (
        <line
          key={y}
          x1={PADDING_X}
          x2={WIDTH - PADDING_X}
          y1={y}
          y2={y}
          stroke="hsl(var(--border))"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <text x="0" y={PADDING_TOP + 4} fill="hsl(var(--muted))" fontSize="11">
        {maxLabel}
      </text>
      <text x="0" y={middle + 4} fill="hsl(var(--muted))" fontSize="11">
        {middleLabel}
      </text>
      <text x="0" y={bottom + 4} fill="hsl(var(--muted))" fontSize="11">
        {minLabel}
      </text>
    </>
  );
}

function TimeLabels({ first, last }: { first: Date; last: Date }) {
  return (
    <>
      <text x={PADDING_X} y={HEIGHT - 8} fill="hsl(var(--muted))" fontSize="11" textAnchor="start">
        {formatChartTime(first)}
      </text>
      <text
        x={WIDTH - PADDING_X}
        y={HEIGHT - 8}
        fill="hsl(var(--muted))"
        fontSize="11"
        textAnchor="end"
      >
        {formatChartTime(last)}
      </text>
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function buildTimedPath(
  points: OperationsHistoryBucket[],
  valueOf: (point: OperationsHistoryBucket) => number | null,
  rangeStart: Date,
  rangeEnd: Date,
  min: number,
  max: number,
): string {
  const segments: string[] = [];
  let previousPoint: OperationsHistoryBucket | undefined;
  let open = false;

  for (const point of points) {
    const value = valueOf(point);
    const hasGap = hasOperationsHistoryGap(previousPoint, point);

    if (value === null) {
      open = false;
      previousPoint = point;
      continue;
    }

    const currentTime = point.checkedAt.getTime();
    const command = open && !hasGap ? 'L' : 'M';
    const x = xAtTime(currentTime, rangeStart.getTime(), rangeEnd.getTime());
    const y = yAt(value, min, max);
    segments.push(command === 'M' ? `M ${x} ${y} L ${x} ${y}` : `L ${x} ${y}`);
    open = !point.hasCollectionGap;
    previousPoint = point;
  }

  return segments.join(' ');
}

function xAtTime(value: number, start: number, end: number): number {
  if (end <= start) return WIDTH / 2;
  const ratio = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return PADDING_X + ratio * (WIDTH - PADDING_X * 2);
}

function yAt(value: number, min: number, max: number): number {
  const bottom = HEIGHT - PADDING_BOTTOM;
  const height = bottom - PADDING_TOP;
  const ratio = max <= min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  return bottom - ratio * height;
}

function formatChartTime(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}
