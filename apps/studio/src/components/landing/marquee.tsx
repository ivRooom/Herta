'use client';

import { useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

/** 流れ続けるリスト。ホバーに頼らず操作できる一時停止ボタン付き (WCAG 2.2.2)。 */
export function Marquee({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);

  return (
    <div className="relative">
      <div className="lp-marquee overflow-hidden">
        <div className={`lp-marquee-track ${paused ? 'lp-paused' : ''}`}>{children}</div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={paused ? '機能一覧の自動スクロールを再開' : '機能一覧の自動スクロールを停止'}
        className="lp-marquee-ctl absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-muted backdrop-blur transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {paused ? (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
