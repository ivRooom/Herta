'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

interface DemoMessage {
  id: string;
  render: () => ReactNode;
}

const AVATAR_TONES = {
  pink: 'bg-[var(--pink)]',
  blue: 'bg-[#6bb8ff]',
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
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ink)] text-sm font-black ${AVATAR_TONES[tone]}`}
        aria-hidden="true"
      >
        {who.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-extrabold">
          {who}
          {bot ? (
            <span className="rounded border-[1.5px] border-[var(--ink)] bg-[var(--yellow)] px-1 py-px text-[10px] font-black leading-none">
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
      <Line who="ミオ" tone="pink">
        今日の20時からVALORANTやる人いる？
      </Line>
    ),
  },
  {
    id: 'm2',
    render: () => (
      <Line who="Herta" tone="bot" bot>
        <div className="mt-1 w-64 max-w-full rounded-lg border-2 border-[var(--ink)] border-l-[6px] border-l-[var(--purple)] bg-white p-3 shadow-[3px_3px_0_var(--ink)]">
          <p className="text-[13px] font-extrabold">VALORANT 募集</p>
          <p className="mt-0.5 text-xs font-medium opacity-70">今日 20:00〜 / 参加 2 / 5</p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full border-2 border-[var(--ink)] bg-white">
            <div className="lp-fill h-full w-2/5 bg-[var(--mint)]" />
          </div>
        </div>
      </Line>
    ),
  },
  {
    id: 'm3',
    render: () => (
      <Line who="タクミ" tone="blue">
        参加します！
      </Line>
    ),
  },
  {
    id: 'm4',
    render: () => (
      <Line who="Herta" tone="bot" bot>
        <span className="inline-block rounded-lg border-2 border-[var(--ink)] bg-[var(--yellow)] px-2.5 py-1 text-[13px] font-extrabold">
          LEVEL UP! ミオ → Lv.12
        </span>
        <span className="mt-1 block text-xs opacity-70">ロール「常連」を付与しました</span>
      </Line>
    ),
  },
  {
    id: 'm5',
    render: () => (
      <p className="lp-msg rounded-lg border-2 border-dashed border-[var(--ink)] bg-[var(--mint-soft)] px-3 py-2 text-xs font-medium leading-5">
        <span className="font-black">Moderation</span>{' '}
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
    <div
      className="pop overflow-hidden rounded-2xl bg-white"
      style={{ boxShadow: '7px 7px 0 var(--ink)' }}
    >
      <div className="flex items-center gap-2 border-b-[2.5px] border-[var(--ink)] bg-[var(--yellow)] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full border-2 border-[var(--ink)] bg-[var(--pink)]" />
          <span className="h-3 w-3 rounded-full border-2 border-[var(--ink)] bg-white" />
          <span className="h-3 w-3 rounded-full border-2 border-[var(--ink)] bg-[var(--mint)]" />
        </span>
        <p className="ml-1 text-[13px] font-extrabold"># general</p>
        <span className="ml-auto text-[11px] font-bold">デモ表示</span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'デモの自動再生を再開' : 'デモの自動再生を一時停止'}
          className="lp-demo-ctl flex h-7 w-7 items-center justify-center rounded-md border-2 border-[var(--ink)] bg-white transition hover:bg-[var(--pink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2"
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
          <div className="flex items-center gap-1.5 pl-12" aria-hidden="true">
            <span className="lp-dot h-2 w-2 rounded-full bg-[var(--ink)]" />
            <span className="lp-dot h-2 w-2 rounded-full bg-[var(--ink)]" />
            <span className="lp-dot h-2 w-2 rounded-full bg-[var(--ink)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
