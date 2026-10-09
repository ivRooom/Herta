'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

interface DemoMessage {
  id: string;
  render: () => ReactNode;
}

function Line({ who, bot = false, children }: { who: string; bot?: boolean; children: ReactNode }) {
  return (
    <div className="lp-msg flex gap-3">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          bot ? 'bg-foreground text-background' : 'bg-border text-foreground'
        }`}
        aria-hidden="true"
      >
        {who.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          {who}
          {bot ? (
            <span className="rounded-sm bg-[#5865F2] px-1 py-px text-[10px] font-medium leading-none text-white">
              BOT
            </span>
          ) : null}
        </p>
        <div className="mt-0.5 text-sm leading-6">{children}</div>
      </div>
    </div>
  );
}

const MESSAGES: DemoMessage[] = [
  {
    id: 'm1',
    render: () => <Line who="ミオ">今日の20時からVALORANTやる人いる？</Line>,
  },
  {
    id: 'm2',
    render: () => (
      <Line who="Herta" bot>
        <div className="mt-1 w-64 max-w-full rounded-md border border-border border-l-[3px] border-l-primary bg-background p-3">
          <p className="text-[13px] font-semibold">VALORANT 募集</p>
          <p className="mt-0.5 text-xs text-muted">今日 20:00〜 / 参加 2 / 5</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
            <div className="lp-fill h-full w-2/5 rounded-full bg-primary" />
          </div>
        </div>
      </Line>
    ),
  },
  {
    id: 'm3',
    render: () => <Line who="タクミ">参加します</Line>,
  },
  {
    id: 'm4',
    render: () => (
      <Line who="Herta" bot>
        ミオ が Lv.12 になりました。ロール「常連」を付与しました。
      </Line>
    ),
  },
  {
    id: 'm5',
    render: () => (
      <p className="lp-msg border-l-2 border-emerald-500 pl-3 text-xs leading-5 text-muted">
        <span className="font-semibold text-foreground">Moderation</span>{' '}
        招待リンクのスパムを検知し、メッセージを削除しました
      </p>
    ),
  },
];

const STEP_MS = 1700;
const HOLD_MS = 4200;

/** Hertaの動作イメージを見せる、ループするチャットのデモ(表示用のダミーデータ)。 */
export function HeroChatDemo() {
  const [count, setCount] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(MESSAGES.length);
      return;
    }
    if (paused) return;
    const timer = window.setTimeout(
      () => setCount((current) => (current >= MESSAGES.length ? 0 : current + 1)),
      count >= MESSAGES.length ? HOLD_MS : count === 0 ? 900 : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [count, paused]);

  const typing = count > 0 && count < MESSAGES.length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="text-[13px] font-semibold text-muted"># general</p>
        <span className="ml-auto text-[11px] text-muted">デモ表示</span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'デモの自動再生を再開' : 'デモの自動再生を一時停止'}
          className="lp-demo-ctl flex h-6 w-6 items-center justify-center rounded border border-border text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {paused ? (
            <Play className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Pause className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </div>

      <div
        className="flex h-[24rem] flex-col justify-end gap-4 overflow-hidden px-4 py-4"
        aria-label="Hertaの動作デモ"
        role="img"
      >
        {MESSAGES.slice(0, count).map((message) => (
          <div key={message.id}>{message.render()}</div>
        ))}
        {typing ? (
          <div className="flex items-center gap-1 pl-11 text-muted" aria-hidden="true">
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
