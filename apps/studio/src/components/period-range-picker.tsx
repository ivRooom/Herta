'use client';

import { useState } from 'react';

export interface PeriodRangePickerPreset {
  value: string;
  label: string;
}

/**
 * 期間preset切り替え + カスタム開始日・終了日指定を提供する共通UI。
 * サーバー側で`force-dynamic`のページに対し、GET navigationでURLの
 * query paramを更新するだけで完結させる(クライアント側の状態は持たない)。
 */
export function PeriodRangePicker({
  basePath,
  preservedParams,
  presets,
  activePeriod,
  customFrom,
  customTo,
  minDate,
  maxDate,
}: {
  basePath: string;
  /** period/from/to以外に維持したいquery param(metric, limitなど)。 */
  preservedParams: Record<string, string>;
  presets: PeriodRangePickerPreset[];
  activePeriod: string;
  customFrom?: string;
  customTo?: string;
  minDate?: string;
  maxDate?: string;
}) {
  const [from, setFrom] = useState(customFrom ?? '');
  const [to, setTo] = useState(customTo ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((preset) => {
        const href = buildHref(basePath, { ...preservedParams, period: preset.value });
        const active = preset.value === activePeriod;
        return (
          <a
            key={preset.value}
            href={href}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-foreground text-background'
                : 'bg-background text-muted hover:text-foreground'
            }`}
          >
            {preset.label}
          </a>
        );
      })}

      <form
        method="GET"
        action={basePath}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
          activePeriod === 'custom' ? 'border-primary/40 bg-primary/5' : 'border-border'
        }`}
      >
        {Object.entries(preservedParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <input type="hidden" name="period" value="custom" />
        <input
          type="date"
          name="from"
          value={from}
          min={minDate}
          max={to || maxDate}
          onChange={(event) => setFrom(event.target.value)}
          className="rounded border border-border bg-background px-1.5 py-1 text-foreground"
          aria-label="開始日"
        />
        <span className="text-muted">〜</span>
        <input
          type="date"
          name="to"
          value={to}
          min={from || minDate}
          max={maxDate}
          onChange={(event) => setTo(event.target.value)}
          className="rounded border border-border bg-background px-1.5 py-1 text-foreground"
          aria-label="終了日"
        />
        <button
          type="submit"
          disabled={!from || !to}
          className="rounded bg-primary/10 px-2 py-1 font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          適用
        </button>
      </form>
    </div>
  );
}

function buildHref(basePath: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${basePath}?${search.toString()}`;
}
