'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { DashboardNav } from './dashboard-nav';

/**
 * モバイル(lg未満)向けのナビゲーションドロワー。デスクトップと同じ
 * grouped nav(Studio/Current Server/Control Center)をそのまま表示し、
 * 横スクロールpill行の代わりに全項目を一覧できるようにする。
 */
export function MobileNavDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ナビゲーションを開く"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="ナビゲーションを閉じる"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Studioナビゲーション"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-surface p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold tracking-tight">Herta Studio</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="ナビゲーションを閉じる"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {/* リンククリックはこのdivまでbubbleするため、遷移と同時にドロワーを閉じる */}
            <div className="mt-4 flex-1" onClick={() => setOpen(false)}>
              <DashboardNav />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
