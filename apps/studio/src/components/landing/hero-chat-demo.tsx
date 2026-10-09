'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

interface DemoMessage {
  id: string;
  render: () => ReactNode;
}

const AVATAR_TONES = {
  guest: 'bg-[var(--lavender)]',
  guest2: 'bg-[var(--lime)]',
  bot: 'bg-[var(--purple)] text-white',
} as const;

function Line({
  who,
  tone,
  bot = false,
  children,
}: {
  who: string;
  tone: keyof typeof AVATAR_TONES;
  bot?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="lp-msg flex gap-3">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-[1.5px] border-[var(--ink)] text-xs font-black ${AVATAR_TONES[tone]}`}
        aria-hidden="true"
      >
        {who.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-bold">
          {who}
          {bot ? (
            <span className="lp-mono rounded-sm bg-[var(--ink)] px-1 py-px text-[9px] font-bold leading-none text-white">
              BOT
            </span>
          ) : null}
        </p>
        <div className="mt-0.5 text-sm font-medium leading-6">{children}</div>
      </div>
    </div>
  );
}

const MESSAGES: DemoMessage[] = [
  {
    id: 'm1',
    render: () => (
      <Line who="ミオ" tone="guest">
        今日の20時からVALORANTやる人いる？
      </Line>
    ),
  },
  {
    id: 'm2',
    render: () => (
      <Line who="Herta" tone="bot" bot>
        <div className="mt-1 w-64 max-w-full rounded-md border-[1.5px] border-[var(--ink)] border-l-[5px] border-l-[var(--purple)] bg-white p-3">
          <p className="text-[13px] font-bold">VALORANT 募集</p>
          <p className="lp-mono mt-0.5 text-[11px] opacity-70">今日 20:00〜 / 参加 2 / 5</p>
          <div className="mt-2 h-2 overflow-hidden rounded-sm border-[1.5px] border-[var(--ink)] bg-white">
            <div className="lp-fill h-full w-2/5 bg-[var(--purple)]" />
          </div>
        </div>
      </Line>
    ),
  },
  {
    id: 'm3',
    render: () => (
      <Line who="タクミ" tone="guest2">
        参加します！
      </Line>
    ),
  },
  {
    id: 'm4',
    render: () => (
      <Line who="Herta" tone="bot" bot>
        <span className="lp-mono inline-block rounded-sm bg-[var(--lime)] px-2 py-0.5 text-xs font-bold">
          LEVEL UP / ミオ → Lv.12
        </span>
        <span className="mt-1 block text-xs opacity-70">ロール「常連」を付与しました</span>
      </Line>
    ),
  },
  {
    id: 'm5',
    render: () => (
      <p className="lp-msg border-l-[3px] border-emerald-500 bg-emerald-50 py-1.5 pl-3 pr-2 text-xs leading-5">
        <span className="lp-mono font-bold">MODERATION</span>{' '}
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
    <div className="box overflow-hidden rounded-lg bg-white shadow-[6px_6px_0_var(--ink)]">
      <div className="flex items-center gap-3 bg-[var(--ink)] px-4 py-2.5 text-white">
        <span className="lp-mono text-xs font-bold"># general</span>
        <span className="lp-mono ml-auto text-[10px] opacity-70">DEMO</span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'デモの自動再生を再開' : 'デモの自動再生を一時停止'}
          className="lp-demo-ctl flex h-6 w-6 items-center justify-center rounded-sm border border-white/40 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {paused ? (
            <Play className="h-3 w-3" aria-hidden="true" fill="currentColor" />
          ) : (
            <Pause className="h-3 w-3" aria-hidden="true" fill="currentColor" />
          )}
        </button>
      </div>

      <div
        className="flex h-[25rem] flex-col justify-end gap-4 overflow-hidden px-4 py-4"
        aria-label="Hertaの動作デモ"
        role="img"
      >
        {MESSAGES.slice(0, count).map((message) => (
          <div key={message.id}>{message.render()}</div>
        ))}
        {typing ? (
          <div className="flex items-center gap-1.5 pl-11" aria-hidden="true">
            <span className="lp-dot h-1.5 w-1.5 rounded-sm bg-[var(--ink)]" />
            <span className="lp-dot h-1.5 w-1.5 rounded-sm bg-[var(--ink)]" />
            <span className="lp-dot h-1.5 w-1.5 rounded-sm bg-[var(--ink)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
