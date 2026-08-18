import type { CommandUsageDay } from '@herta/db';
import { BarChart3 } from 'lucide-react';

function formatDayLabel(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(date);
}

export function GuildCommandTrendChart({ daily }: { daily: readonly CommandUsageDay[] }) {
  const maximum = Math.max(...daily.map((day) => day.total), 1);
  const total = daily.reduce((sum, day) => sum + day.total, 0);
  const failed = daily.reduce((sum, day) => sum + day.failed, 0);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">Command Activity</h2>
          </div>
          <p className="mt-1 text-sm text-muted">直近7日・JSTの日次実行推移です。</p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>{total.toLocaleString()} executions</p>
          <p className={failed > 0 ? 'text-amber-500' : undefined}>{failed} failed</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="mt-6 flex h-44 items-center justify-center rounded-xl border border-dashed border-border bg-background/50 px-4 text-center text-sm text-muted">
          直近7日のCommand実行履歴はまだありません。
        </div>
      ) : (
        <div className="mt-6">
          <div
            className="flex h-44 items-end gap-2 sm:gap-3"
            role="img"
            aria-label={`直近7日のCommand実行推移。全${total}件、失敗${failed}件。`}
          >
            {daily.map((day) => {
              const heightPercent = Math.max(6, (day.total / maximum) * 100);
              const failurePercent = day.total === 0 ? 0 : (day.failed / day.total) * 100;
              return (
                <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex h-32 w-full items-end">
                    <div
                      className="relative w-full overflow-hidden rounded-t-md bg-primary/80"
                      style={{ height: `${heightPercent}%` }}
                      title={`${formatDayLabel(day.date)}: ${day.total}件（失敗 ${day.failed}件）`}
                      aria-hidden="true"
                    >
                      {failurePercent > 0 ? (
                        <div
                          className="absolute inset-x-0 bottom-0 bg-amber-500"
                          style={{ height: `${failurePercent}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <span className="text-[10px] tabular-nums text-muted sm:text-xs">
                    {formatDayLabel(day.date)}
                  </span>
                  <span className="sr-only">
                    {day.date}: {day.total}件、失敗{day.failed}件
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              実行数
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
              失敗
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
