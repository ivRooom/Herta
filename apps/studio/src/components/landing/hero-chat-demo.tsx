'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

interface DemoMessage {
  id: string;
  render: () => ReactNode;
}

const AVATAR_TONES = {
  guest: 'bg-[#e5e5ea] text-[var(--ink)]',
  guest2: 'bg-[var(--lavender)] text-[var(--purple)]',
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
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${AVATAR_TONES[tone]}`}
        aria-hidden="true"
      >
        {who.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold">
          {who}
          {bot ? (
            <span className="rounded bg-[var(--ink)] px-1 py-px text-[9px] font-semibold leading-none text-white">
              BOT
            </span>
          ) : null}
        </p>
        <div className="mt-0.5 text-[15px] leading-6">{children}</div>
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
        <div className="mt-1.5 w-72 max-w-full rounded-2xl bg-[var(--tint)] p-4">
          <p className="text-sm font-semibold">VALORANT 募集</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">今日 20:00〜 ・ 参加 2 / 5</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5e5ea]">
            <div className="lp-fill h-full w-2/5 rounded-full bg-[var(--purple)]" />
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
        <span className="inline-block rounded-full bg-[var(--lavender)] px-3 py-1 text-[13px] font-semibold text-[var(--purple)]">
          ミオが Lv.12 に到達
        </span>
        <span className="mt-1 block text-xs text-[var(--muted)]">ロール「常連」を付与しました</span>
      </Line>
    ),
  },
  {
    id: 'm5',
    render: () => (
      <p className="lp-msg rounded-xl bg-[var(--tint)] px-3.5 py-2.5 text-xs leading-5 text-[var(--muted)]">
        <span className="font-semibold text-[var(--ink)]">Moderation</span>　
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
    <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_40px_80px_-30px_rgb(0_0_0/0.28),0_0_0_1px_rgb(0_0_0/0.06)]">
      <div className="flex items-center gap-3 border-b border-black/5 px-5 py-3.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </span>
        <p className="flex-1 text-center text-[13px] font-semibold text-[var(--muted)]">
          # general
        </p>
        <span className="text-[11px] text-[var(--muted)]">デモ</span>
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'デモの自動再生を再開' : 'デモの自動再生を一時停止'}
          className="lp-demo-ctl flex h-7 w-7 items-center justify-center rounded-full bg-[var(--tint)] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)]"
        >
          {paused ? (
            <Play className="h-3 w-3" aria-hidden="true" fill="currentColor" />
          ) : (
            <Pause className="h-3 w-3" aria-hidden="true" fill="currentColor" />
          )}
        </button>
      </div>

      <div
        className="flex h-[26rem] flex-col justify-end gap-5 overflow-hidden px-5 py-5"
        aria-label="Hertaの動作デモ"
        role="img"
      >
        {MESSAGES.slice(0, count).map((message) => (
          <div key={message.id}>{message.render()}</div>
        ))}
        {typing ? (
          <div className="flex items-center gap-1.5 pl-12" aria-hidden="true">
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
            <span className="lp-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
