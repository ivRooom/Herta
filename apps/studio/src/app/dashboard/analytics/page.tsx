import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Command,
  Gauge,
  History,
  Search,
  Server,
  TrendingUp,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import {
  getCommandUsageAnalytics,
  searchCommandExecutionEvents,
  type CommandExecutionSearchResult,
  type CommandUsageAnalytics,
} from '@herta/db';
import { RefreshHealthButton } from '@/components/refresh-health-button';
import { prisma } from '@/lib/db';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface SummaryCardProps {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
}

type SearchParams = Record<string, string | string[] | undefined>;

type AnalyticsDashboardPageProps = {
  searchParams?: Promise<SearchParams>;
};

const RANGE_OPTIONS = [7, 30, 90] as const;

function SummaryCard({ title, value, description, icon: Icon }: SummaryCardProps) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
        </div>
        <span className="rounded-xl border border-border bg-background p-2.5 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </section>
  );
}

function readSingle(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseRange(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return RANGE_OPTIONS.includes(parsed as (typeof RANGE_OPTIONS)[number]) ? parsed : 7;
}

function parsePage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
}

function formatDayLabel(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${value}ms`;
  return `${(value / 1_000).toFixed(1)}秒`;
}

function buildHref(params: SearchParams, overrides: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params)) {
    const value = readSingle(rawValue);
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === '') query.delete(key);
    else query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `/dashboard/analytics?${suffix}` : '/dashboard/analytics';
}

function TrendChart({ analytics }: { analytics: CommandUsageAnalytics }) {
  const width = 760;
  const height = 240;
  const left = 28;
  const right = 18;
  const top = 18;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maximum = Math.max(...analytics.daily.map((day) => day.total), 1);
  const denominator = Math.max(analytics.daily.length - 1, 1);

  const pointFor = (value: number, index: number) => {
    const x = left + (index / denominator) * chartWidth;
    const y = top + chartHeight - (value / maximum) * chartHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const totalPoints = analytics.daily.map((day, index) => pointFor(day.total, index)).join(' ');
  const failurePoints = analytics.daily.map((day, index) => pointFor(day.failed, index)).join(' ');
  const labelStep = Math.max(1, Math.ceil(analytics.daily.length / 6));

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-medium">コマンド実行トレンド</h2>
          </div>
          <p className="mt-1 text-sm text-muted">過去{analytics.rangeDays}日を日本時間で集計。</p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            全実行
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            失敗
          </span>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`過去${analytics.rangeDays}日のコマンド実行数と失敗数の推移`}
          className="min-w-[620px] w-full"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + chartHeight - ratio * chartHeight;
            return (
              <g key={ratio}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="stroke-border"
                  strokeWidth="1"
                />
                <text x="2" y={y + 4} className="fill-muted text-[10px]">
                  {Math.round(maximum * ratio)}
                </text>
              </g>
            );
          })}
          <polyline
            points={totalPoints}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          />
          <polyline
            points={failurePoints}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-red-500"
          />
          {analytics.daily.map((day, index) => {
            const show = index % labelStep === 0 || index === analytics.daily.length - 1;
            if (!show) return null;
            const x = left + (index / denominator) * chartWidth;
            return (
              <text
                key={day.date}
                x={x}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {formatDayLabel(day.date)}
              </text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function HourlyChart({ analytics }: { analytics: CommandUsageAnalytics }) {
  const maximum = Math.max(...analytics.hourly.map((hour) => hour.total), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-2">
        <Clock3 className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-medium">時間帯別の利用</h2>
      </div>
      <p className="mt-1 text-sm text-muted">JST 0〜23時の実行分布です。</p>

      <div className="mt-6 flex h-40 items-end gap-1 sm:gap-1.5">
        {analytics.hourly.map((hour) => {
          const height = hour.total === 0 ? 3 : Math.max(8, (hour.total / maximum) * 128);
          return (
            <div key={hour.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className="w-full rounded-t bg-primary/80 transition-opacity hover:opacity-80"
                style={{ height }}
                title={`${hour.hour}時: ${hour.total}件（失敗 ${hour.failed}件）`}
              />
              <span className="text-[9px] text-muted sm:text-[10px]">
                {hour.hour % 3 === 0 ? hour.hour : ''}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CommandRanking({ analytics }: { analytics: CommandUsageAnalytics }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-medium">コマンド別パフォーマンス</h2>
      </div>
      <p className="mt-1 text-sm text-muted">実行数・成功率・平均処理時間の上位10件。</p>

      {analytics.ranking.length === 0 ? (
        <p className="mt-6 text-sm text-muted">表示できる実行履歴がありません。</p>
      ) : (
        <div className="mt-5 space-y-3">
          {analytics.ranking.map((command, index) => (
            <div
              key={command.commandName}
              className="rounded-xl border border-border bg-background px-4 py-3"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 truncate text-sm font-medium">
                  <span className="mr-2 text-muted">{index + 1}.</span>/{command.commandName}
                </p>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {command.total}件
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                <span>成功率 {command.successRate === null ? '—' : `${command.successRate}%`}</span>
                <span>平均 {formatDuration(command.averageDurationMs)}</span>
                <span>P95 {formatDuration(command.p95DurationMs)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ErrorRanking({ analytics }: { analytics: CommandUsageAnalytics }) {
  const maximum = Math.max(...analytics.errors.map((error) => error.total), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-5 w-5 text-amber-500" aria-hidden="true" />
        <h2 className="font-medium">エラー種別</h2>
      </div>
      <p className="mt-1 text-sm text-muted">失敗原因の発生回数を多い順に表示。</p>

      {analytics.errors.length === 0 ? (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
          選択期間内のコマンド失敗はありません。
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {analytics.errors.map((error) => (
            <div key={error.errorName}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{error.errorName}</span>
                <span className="shrink-0 tabular-nums text-muted">{error.total}件</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.max(4, (error.total / maximum) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentFailures({ analytics }: { analytics: CommandUsageAnalytics }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-2">
        <XCircle className="h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
        <h2 className="font-medium">直近の失敗</h2>
      </div>
      <p className="mt-1 text-sm text-muted">選択期間内の最新10件。</p>

      {analytics.recentFailures.length === 0 ? (
        <p className="mt-6 text-sm text-muted">記録されている失敗はありません。</p>
      ) : (
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {analytics.recentFailures.map((failure, index) => (
            <div
              key={`${failure.executedAt}-${failure.commandName}-${index}`}
              className="grid gap-2 bg-background px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">/{failure.commandName}</p>
                <p className="mt-1 truncate text-xs text-muted">
                  {failure.errorName ?? 'UnknownError'} · {formatDateTime(failure.executedAt)}
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted">
                {formatDuration(failure.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CommandHistory({
  history,
  params,
  query,
  guildId,
  status,
  rangeDays,
}: {
  history: CommandExecutionSearchResult;
  params: SearchParams;
  query: string;
  guildId: string;
  status: string;
  rangeDays: number;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-medium">コマンド履歴</h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            管理権限のあるGuildのみ、コマンド名・Guild ID・エラー名で検索できます。{history.total}
            件一致。
          </p>
        </div>
      </div>

      <form method="get" className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr_0.7fr_auto]">
        <input type="hidden" name="range" value={rangeDays} />
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            name="q"
            defaultValue={query}
            placeholder="例: ping / Error / Guild ID"
            className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input
          name="guild"
          defaultValue={guildId}
          placeholder="Guild IDで絞り込み"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          name="status"
          defaultValue={status}
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">すべて</option>
          <option value="success">成功</option>
          <option value="failure">失敗</option>
        </select>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            検索
          </button>
          <Link
            href={`/dashboard/analytics?range=${rangeDays}`}
            className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted hover:bg-background hover:text-foreground"
          >
            解除
          </Link>
        </div>
      </form>

      {history.items.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
          条件に一致するコマンド履歴がありません。
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border">
          <table className="min-w-[820px] w-full text-left text-sm">
            <thead className="border-b border-border bg-background/70 text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">実行日時</th>
                <th className="px-4 py-3 font-medium">コマンド</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3 font-medium">Guild</th>
                <th className="px-4 py-3 font-medium">処理時間</th>
                <th className="px-4 py-3 font-medium">エラー</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.items.map((item) => (
                <tr key={item.id} className="bg-surface hover:bg-background/50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {formatDateTime(item.executedAt)}
                  </td>
                  <td className="px-4 py-3 font-medium">/{item.commandName}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs ${
                        item.status === 'success'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                      }`}
                    >
                      {item.status === 'success' ? '成功' : '失敗'}
                    </span>
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 font-mono text-xs text-muted">
                    {item.guildId ?? 'DM / 不明'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">
                    {formatDuration(item.durationMs)}
                  </td>
                  <td className="max-w-56 truncate px-4 py-3 text-xs text-muted">
                    {item.errorName ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">
          {history.page} / {history.totalPages} ページ
        </span>
        <div className="flex gap-2">
          <Link
            aria-disabled={history.page <= 1}
            href={buildHref(params, { page: String(Math.max(1, history.page - 1)) })}
            className={`rounded-lg border border-border px-3 py-2 ${history.page <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-background'}`}
          >
            前へ
          </Link>
          <Link
            aria-disabled={history.page >= history.totalPages}
            href={buildHref(params, {
              page: String(Math.min(history.totalPages, history.page + 1)),
            })}
            className={`rounded-lg border border-border px-3 py-2 ${history.page >= history.totalPages ? 'pointer-events-none opacity-40' : 'hover:bg-background'}`}
          >
            次へ
          </Link>
        </div>
      </div>
    </section>
  );
}

function EmptyAnalytics() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
      <Command className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
      <h2 className="mt-4 font-medium">コマンド実行履歴はまだありません</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
        本番反映後に実行されたSlash Commandから集計します。過去データの自動補完は行いません。
      </p>
    </section>
  );
}

export default async function AnalyticsDashboardPage({
  searchParams,
}: AnalyticsDashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const rangeDays = parseRange(readSingle(params['range']));
  const query = readSingle(params['q']).trim();
  const guildId = readSingle(params['guild']).trim();
  const rawStatus = readSingle(params['status']);
  const status = rawStatus === 'success' || rawStatus === 'failure' ? rawStatus : 'all';
  const page = parsePage(readSingle(params['page']));

  const accessToken = await getDiscordAccessToken();
  let allowedGuildIds: string[] | null = null;
  if (accessToken) {
    try {
      allowedGuildIds = (await getManageableGuilds(accessToken)).map((guild) => guild.id);
    } catch {
      allowedGuildIds = null;
    }
  }

  const analyticsPromise = allowedGuildIds
    ? getCommandUsageAnalytics(prisma, { days: rangeDays, guildIds: allowedGuildIds })
    : Promise.resolve<CommandUsageAnalytics | null>(null);
  const historyPromise = allowedGuildIds
    ? searchCommandExecutionEvents(prisma, {
        rangeDays,
        query,
        guildId,
        status,
        page,
        allowedGuildIds,
      })
    : Promise.resolve<CommandExecutionSearchResult | null>(null);

  const [analyticsResult, historyResult] = await Promise.allSettled([
    analyticsPromise,
    historyPromise,
  ]);

  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value : null;
  const manageableGuildCount = allowedGuildIds?.length ?? null;

  return (
    <div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Analytics v2
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bot利用状況とコマンド履歴</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            管理権限のあるGuildについて、実行推移、成功率、レイテンシ、時間帯、エラー傾向を可視化し、コマンド履歴を検索できます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border bg-background p-1">
            {RANGE_OPTIONS.map((range) => (
              <Link
                key={range}
                href={buildHref(params, { range: String(range), page: '1' })}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  rangeDays === range
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {range}日
              </Link>
            ))}
          </div>
          <RefreshHealthButton />
        </div>
      </div>

      {!analytics ? (
        <section className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert
              className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-medium text-amber-800 dark:text-amber-200">
                Analyticsの認可情報を取得できませんでした
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-amber-800/80 dark:text-amber-200/80">
                Discord
                APIのレート制限またはセッション切れの場合、他Guildの情報を誤表示しないためAnalyticsと履歴を非表示にします。
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <SummaryCard
              title="本日の実行"
              value={`${analytics.today.total}件`}
              description={`成功 ${analytics.today.succeeded} / 失敗 ${analytics.today.failed}`}
              icon={Activity}
            />
            <SummaryCard
              title={`${analytics.rangeDays}日間の実行`}
              value={`${analytics.range.total}件`}
              description={`1日平均 ${(analytics.range.total / analytics.rangeDays).toFixed(1)}件`}
              icon={Command}
            />
            <SummaryCard
              title="成功率"
              value={analytics.range.successRate === null ? '—' : `${analytics.range.successRate}%`}
              description={`失敗 ${analytics.range.failed}件`}
              icon={CheckCircle2}
            />
            <SummaryCard
              title="平均処理時間"
              value={formatDuration(analytics.range.averageDurationMs)}
              description="全コマンドの平均レイテンシ"
              icon={Gauge}
            />
            <SummaryCard
              title="P95処理時間"
              value={formatDuration(analytics.range.p95DurationMs)}
              description="95%の実行がこの時間以内"
              icon={Clock3}
            />
            <SummaryCard
              title="管理対象サーバー"
              value={manageableGuildCount === null ? '—' : `${manageableGuildCount}件`}
              description="現在のDiscord権限で管理できるGuild数"
              icon={Server}
            />
          </div>

          <div className="mt-6">
            {analytics.range.total === 0 ? (
              <EmptyAnalytics />
            ) : (
              <TrendChart analytics={analytics} />
            )}
          </div>

          {analytics.range.total > 0 ? (
            <>
              <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <HourlyChart analytics={analytics} />
                <ErrorRanking analytics={analytics} />
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <CommandRanking analytics={analytics} />
                <RecentFailures analytics={analytics} />
              </div>
            </>
          ) : null}

          <p className="mt-6 text-right text-xs text-muted">
            集計更新: {formatDateTime(analytics.generatedAt)}
          </p>
        </>
      )}

      {history ? (
        <CommandHistory
          history={history}
          params={params}
          query={query}
          guildId={guildId}
          status={status}
          rangeDays={rangeDays}
        />
      ) : null}
    </div>
  );
}
