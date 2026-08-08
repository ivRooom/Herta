import Link from 'next/link';
import type { ReactNode } from 'react';
import { listServiceHealthSnapshots, type ServiceHealthSnapshotRecord } from '@herta/db';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Database,
  Gauge,
  History,
  Radio,
  Server,
  TriangleAlert,
  WifiOff,
  Wrench,
  XCircle,
} from 'lucide-react';
import { OperationsHistoryChart } from '@/components/operations-history-chart';
import { RefreshHealthButton } from '@/components/refresh-health-button';
import { getBotHealth, type BotCheckStatus, type BotServiceStatus } from '@/lib/bot-health';
import { prisma } from '@/lib/db';
import {
  bucketOperationsHistory,
  OPERATIONS_RANGE_CONFIG,
  resolveOperationsRange,
  summarizeOperationsHistory,
  type OperationsRangeKey,
} from '@/lib/operations-history';

export const dynamic = 'force-dynamic';

interface StatusMeta {
  label: string;
  description: string;
  className: string;
  icon: LucideIcon;
}

const CHECK_STATUS_META: Record<BotCheckStatus, StatusMeta> = {
  ok: {
    label: '正常',
    description: '正常に応答しています',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  warning: {
    label: '注意',
    description: '応答していますが確認が必要です',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: TriangleAlert,
  },
  error: {
    label: '異常',
    description: '正常に応答していません',
    className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    icon: XCircle,
  },
  not_configured: {
    label: '未設定',
    description: 'この依存先は設定されていません',
    className: 'border-border bg-background text-muted',
    icon: Wrench,
  },
  unknown: {
    label: '不明',
    description: '状態を判定できませんでした',
    className: 'border-border bg-background text-muted',
    icon: CircleHelp,
  },
};

const SERVICE_STATUS_META: Record<BotServiceStatus, StatusMeta> = {
  operational: {
    label: 'すべて正常',
    description: 'Herta Bot と依存サービスは正常に動作しています。',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  degraded: {
    label: '一部で注意が必要',
    description: 'サービスは動作していますが、一部の状態を確認してください。',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: TriangleAlert,
  },
  outage: {
    label: '障害を検出',
    description: 'Botまたは依存サービスが正常に応答していません。',
    className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    icon: XCircle,
  },
  maintenance: {
    label: 'メンテナンス中',
    description: '現在メンテナンス状態です。',
    className: 'border-primary/30 bg-primary/10 text-primary',
    icon: Wrench,
  },
  unknown: {
    label: '状態不明',
    description: 'Botから有効な状態を取得できませんでした。',
    className: 'border-border bg-surface text-muted',
    icon: CircleHelp,
  },
};

const unavailableMessages = {
  not_configured: {
    title: 'Botヘルス接続が未設定です',
    description: 'StudioのBOT_HEALTH_URLを設定すると、ここに稼働状況が表示されます。',
  },
  unreachable: {
    title: 'Botヘルスへ接続できません',
    description: 'Botコンテナ、内部ネットワーク、またはヘルスサーバーの状態を確認してください。',
  },
  invalid_response: {
    title: 'Botヘルスの応答形式が不正です',
    description: 'BotとStudioのバージョン差異、またはヘルスレスポンスを確認してください。',
  },
} as const;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未記録';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}日 ${hours}時間`;
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  return `${minutes}分`;
}

function StatusBadge({ status }: { status: BotCheckStatus }) {
  const meta = CHECK_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function CheckCard({
  title,
  description,
  status,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  status: BotCheckStatus;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-border bg-background p-2.5 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-medium">{title}</h2>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      <dl className="mt-5">{children}</dl>
    </section>
  );
}

function HistoryMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>
    </div>
  );
}

export default async function OperationsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const rangeKey = resolveOperationsRange(range);
  const rangeConfig = OPERATIONS_RANGE_CONFIG[rangeKey];
  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd.getTime() - rangeConfig.durationMs);
  const [result, history] = await Promise.all([getBotHealth(), loadHistory(rangeStart)]);
  const buckets = bucketOperationsHistory(history.snapshots, rangeConfig.bucketMs);
  const summary = summarizeOperationsHistory(history.snapshots, rangeStart, rangeEnd);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Activity className="h-4 w-4" aria-hidden="true" />
            Operations
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bot稼働状況</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            現在状態だけでなく、24時間・7日・30日の稼働率、latency、障害傾向を確認できます。
          </p>
        </div>
        <RefreshHealthButton />
      </div>

      {!result.available ? (
        <section className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
          <div className="flex items-start gap-3">
            <WifiOff
              className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-medium text-amber-800 dark:text-amber-200">
                {unavailableMessages[result.reason].title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-amber-800/80 dark:text-amber-200/80">
                {unavailableMessages[result.reason].description}
              </p>
              <p className="mt-3 text-xs text-muted">
                最終確認: {formatDateTime(result.fetchedAt)}
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section
            className={`mt-8 rounded-2xl border p-6 ${SERVICE_STATUS_META[result.health.status].className}`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {(() => {
                  const Icon = SERVICE_STATUS_META[result.health.status].icon;
                  return <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />;
                })()}
                <div>
                  <h2 className="text-lg font-semibold">
                    {SERVICE_STATUS_META[result.health.status].label}
                  </h2>
                  <p className="mt-1 text-sm opacity-80">
                    {SERVICE_STATUS_META[result.health.status].description}
                  </p>
                </div>
              </div>
              <div className="text-sm sm:text-right">
                <p className="font-medium">v{result.health.version}</p>
                <p className="mt-1 opacity-75">HTTP {result.httpStatus}</p>
              </div>
            </div>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Bot確認: {formatDateTime(result.health.checked_at)}
            </span>
            <span>Studio取得: {formatDateTime(result.fetchedAt)}</span>
            <span>稼働時間: {formatUptime(result.health.uptime_seconds)}</span>
          </div>
        </>
      )}

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">過去の稼働状況</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Botが5分間隔で保存するHealth
              Snapshotから稼働率・障害・依存サービスlatencyを集計します。
            </p>
          </div>
          <div
            className="flex rounded-xl border border-border bg-background p-1"
            role="group"
            aria-label="履歴期間"
          >
            {(Object.keys(OPERATIONS_RANGE_CONFIG) as OperationsRangeKey[]).map((key) => (
              <Link
                key={key}
                href={`/dashboard/operations?range=${key}`}
                aria-current={key === rangeKey ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  key === rangeKey
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {OPERATIONS_RANGE_CONFIG[key].label}
              </Link>
            ))}
          </div>
        </div>

        {!history.available ? (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
            稼働履歴テーブルを読み込めませんでした。Migration適用後に自動で利用可能になります。
          </div>
        ) : null}

        {history.available ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <HistoryMetric
                label="記録サンプル稼働率"
                value={
                  summary.availabilityPercent === null ? '—' : `${summary.availabilityPercent}%`
                }
                hint={`${rangeConfig.label}のoperational比率`}
              />
              <HistoryMetric
                label="記録カバレッジ"
                value={`${summary.coveragePercent}%`}
                hint="5分間隔の期待サンプルに対する記録率"
              />
              <HistoryMetric
                label="インシデント"
                value={`${summary.incidentCount}件`}
                hint="正常→非正常への状態遷移"
              />
              <HistoryMetric
                label="非正常推定時間"
                value={`${summary.nonOperationalMinutes}分`}
                hint="degraded/outage/unknown等の推定時間"
              />
              <HistoryMetric
                label="DB平均latency"
                value={summary.databaseLatencyMs === null ? '—' : `${summary.databaseLatencyMs}ms`}
                hint={
                  summary.collectionGapMinutes > 0
                    ? `収集gap 約${summary.collectionGapMinutes}分`
                    : '記録されたprobe平均'
                }
              />
            </div>

            {summary.coveragePercent < 80 ? (
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs leading-5 text-muted">
                履歴収集を開始した直後はカバレッジが低く表示されます。5分ごとに自動蓄積され、時間の経過とともに選択期間を満たします。
              </div>
            ) : null}

            <div className="mt-6">
              <OperationsHistoryChart
                points={buckets}
                rangeLabel={rangeConfig.label}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
              />
            </div>
          </>
        ) : null}
      </section>

      {result.available ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <CheckCard
            title="Botプロセス"
            description="Herta Botの実行プロセス"
            status={result.health.checks.process.status}
            icon={Bot}
          >
            <Detail
              label="状態"
              value={CHECK_STATUS_META[result.health.checks.process.status].description}
            />
            <Detail label="バージョン" value={result.health.version} />
            <Detail label="稼働時間" value={formatUptime(result.health.uptime_seconds)} />
          </CheckCard>

          <CheckCard
            title="Discord Gateway"
            description="Discordとの接続とHeartbeat"
            status={result.health.checks.discord.status}
            icon={Radio}
          >
            <Detail label="Gateway" value={result.health.checks.discord.gateway_status} />
            <Detail
              label="接続"
              value={result.health.checks.discord.connected ? '接続済み' : '未接続'}
            />
            <Detail
              label="Ready"
              value={result.health.checks.discord.ready ? '準備完了' : '未完了'}
            />
            <Detail
              label="最終Heartbeat"
              value={formatDateTime(result.health.checks.discord.last_heartbeat_at)}
            />
          </CheckCard>

          <CheckCard
            title="PostgreSQL"
            description="Botからデータベースへの疎通"
            status={result.health.checks.database.status}
            icon={Database}
          >
            <Detail
              label="状態"
              value={CHECK_STATUS_META[result.health.checks.database.status].description}
            />
            <Detail
              label="応答時間"
              value={
                result.health.checks.database.latency_ms === undefined
                  ? '—'
                  : `${result.health.checks.database.latency_ms} ms`
              }
            />
          </CheckCard>

          <CheckCard
            title="Redis"
            description="キャッシュ・Queue基盤への疎通"
            status={result.health.checks.redis.status}
            icon={Server}
          >
            <Detail
              label="状態"
              value={CHECK_STATUS_META[result.health.checks.redis.status].description}
            />
            <Detail
              label="応答時間"
              value={
                result.health.checks.redis.latency_ms === undefined
                  ? '—'
                  : `${result.health.checks.redis.latency_ms} ms`
              }
            />
          </CheckCard>

          <CheckCard
            title="Worker"
            description="非同期処理WorkerのHeartbeat"
            status={result.health.checks.worker.status}
            icon={Activity}
          >
            <Detail
              label="状態"
              value={CHECK_STATUS_META[result.health.checks.worker.status].description}
            />
            <Detail
              label="最終Heartbeat"
              value={formatDateTime(result.health.checks.worker.last_heartbeat_at)}
            />
            <Detail
              label="確認応答時間"
              value={
                result.health.checks.worker.latency_ms === undefined
                  ? '—'
                  : `${result.health.checks.worker.latency_ms} ms`
              }
            />
          </CheckCard>

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-border bg-background p-2.5 text-primary">
                <Gauge className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-medium">履歴Collector</h2>
                <p className="mt-1 text-sm text-muted">Studioアクセスに依存しない定期Snapshot</p>
              </div>
            </div>
            <dl className="mt-5">
              <Detail label="収集間隔" value="5分" />
              <Detail label="表示bucket" value={formatBucket(rangeConfig.bucketMs)} />
              <Detail label="記録件数" value={`${history.snapshots.length}件`} />
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

async function loadHistory(
  since: Date,
): Promise<{ available: boolean; snapshots: ServiceHealthSnapshotRecord[] }> {
  try {
    const snapshots = await listServiceHealthSnapshots(prisma, 'herta-discord-bot', since, 10_000);
    return { available: true, snapshots };
  } catch (error) {
    console.error(
      'Operations health history query failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return { available: false, snapshots: [] };
  }
}

function formatBucket(bucketMs: number): string {
  const minutes = Math.round(bucketMs / 60_000);
  return minutes >= 60 ? `${Math.round(minutes / 60)}時間` : `${minutes}分`;
}
