import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleAlert,
  Command,
  Server,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { getCommandUsageAnalytics, type CommandUsageAnalytics } from '@herta/db';
import { RefreshHealthButton } from '@/components/refresh-health-button';
import { getBotHealth } from '@/lib/bot-health';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SummaryCardProps {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
}

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

function UsageChart({ analytics }: { analytics: CommandUsageAnalytics }) {
  const maximum = Math.max(...analytics.daily.map((day) => day.total), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-medium">過去7日間の実行推移</h2>
          </div>
          <p className="mt-1 text-sm text-muted">日本時間の日付単位で集計しています。</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            成功
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            失敗
          </span>
        </div>
      </div>

      <div className="mt-8 grid min-h-56 grid-cols-7 items-end gap-2 sm:gap-4">
        {analytics.daily.map((day) => {
          const totalHeight = day.total === 0 ? 4 : Math.max(16, (day.total / maximum) * 176);
          const failureRatio = day.total === 0 ? 0 : day.failed / day.total;
          const failureHeight = totalHeight * failureRatio;
          const successHeight = totalHeight - failureHeight;

          return (
            <div key={day.date} className="flex min-w-0 flex-col items-center gap-2">
              <span className="text-xs font-medium tabular-nums">{day.total}</span>
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-lg bg-background"
                style={{ height: `${totalHeight}px` }}
                title={`${day.date}: 成功${day.succeeded}件 / 失敗${day.failed}件`}
              >
                {successHeight > 0 ? (
                  <span
                    className="block w-full bg-emerald-500"
                    style={{ height: `${successHeight}px` }}
                  />
                ) : null}
                {failureHeight > 0 ? (
                  <span
                    className="block w-full bg-red-500"
                    style={{ height: `${failureHeight}px` }}
                  />
                ) : null}
              </div>
              <span className="truncate text-[11px] text-muted sm:text-xs">
                {formatDayLabel(day.date)}
              </span>
            </div>
          );
        })}
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
        この機能を本番へ反映した後に実行されたSlash
        Commandから集計を開始します。過去データの自動補完は行いません。
      </p>
    </section>
  );
}

export default async function AnalyticsDashboardPage() {
  const [analyticsResult, healthResult] = await Promise.allSettled([
    getCommandUsageAnalytics(prisma),
    getBotHealth(),
  ]);

  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null;
  const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const guildCount = health?.available ? health.health.guild_count : null;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Analytics
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bot利用状況</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Slash Commandの実行数、成功率、利用傾向、直近の失敗を確認できます。
          </p>
        </div>
        <RefreshHealthButton />
      </div>

      {!analytics ? (
        <section className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="flex items-start gap-3">
            <CircleAlert
              className="mt-0.5 h-5 w-5 text-red-700 dark:text-red-300"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-medium text-red-800 dark:text-red-200">
                利用状況を取得できませんでした
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-red-800/80 dark:text-red-200/80">
                DB
                migration、PostgreSQL接続、Studioログを確認してください。Bot本体のコマンド実行には影響しません。
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="本日の実行数"
              value={`${analytics.today.total}件`}
              description={`成功 ${analytics.today.succeeded}件 / 失敗 ${analytics.today.failed}件`}
              icon={Activity}
            />
            <SummaryCard
              title="過去7日間"
              value={`${analytics.last7Days.total}件`}
              description="本日を含む日本時間の7日間"
              icon={Command}
            />
            <SummaryCard
              title="成功率"
              value={
                analytics.last7Days.successRate === null
                  ? '—'
                  : `${analytics.last7Days.successRate.toFixed(1)}%`
              }
              description={`失敗 ${analytics.last7Days.failed}件`}
              icon={CheckCircle2}
            />
            <SummaryCard
              title="Bot参加サーバー"
              value={guildCount === null ? '—' : `${guildCount}件`}
              description="Discord Gatewayが現在認識しているGuild数"
              icon={Server}
            />
          </div>

          <div className="mt-6">
            {analytics.last7Days.total === 0 ? (
              <EmptyAnalytics />
            ) : (
              <UsageChart analytics={analytics} />
            )}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
                <h2 className="font-medium">よく使われているコマンド</h2>
              </div>
              <p className="mt-1 text-sm text-muted">過去7日間の上位8件です。</p>

              {analytics.ranking.length === 0 ? (
                <p className="mt-6 text-sm text-muted">表示できる実行履歴がありません。</p>
              ) : (
                <ol className="mt-5 space-y-3">
                  {analytics.ranking.map((command, index) => (
                    <li
                      key={command.commandName}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <span className="mr-2 text-muted">{index + 1}.</span>/
                          {command.commandName}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          成功 {command.succeeded}件 / 失敗 {command.failed}件
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {command.total}件
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
                <h2 className="font-medium">直近の失敗</h2>
              </div>
              <p className="mt-1 text-sm text-muted">
                入力値やユーザー情報を含まない、最新10件のエラー種別です。
              </p>

              {analytics.recentFailures.length === 0 ? (
                <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                  記録されているコマンド失敗はありません。
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-xl border border-border">
                  <div className="divide-y divide-border">
                    {analytics.recentFailures.map((failure, index) => (
                      <div
                        key={`${failure.executedAt}-${failure.commandName}-${index}`}
                        className="grid gap-2 bg-background px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">/{failure.commandName}</p>
                          <p className="mt-1 truncate text-xs text-muted">
                            {failure.errorName ?? 'UnknownError'} ·{' '}
                            {formatDateTime(failure.executedAt)}
                          </p>
                        </div>
                        <span className="text-xs tabular-nums text-muted">
                          {formatDuration(failure.durationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <p className="mt-6 text-right text-xs text-muted">
            集計更新: {formatDateTime(analytics.generatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
