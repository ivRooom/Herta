'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Crown, Pause, Play, ShieldCheck, Sparkles, Trophy } from 'lucide-react';

interface DemoMessage {
  id: string;
  render: () => ReactNode;
}

function Avatar({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${tone}`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function Line({
  avatar,
  name,
  badge,
  children,
}: {
  avatar: ReactNode;
  name: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lp-msg flex gap-3">
      {avatar}
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {name}
          {badge}
        </p>
        <div className="mt-0.5 text-sm leading-6 text-foreground/90">{children}</div>
      </div>
    </div>
  );
}

const BOT_BADGE = (
  <span className="rounded bg-[#5865F2] px-1.5 py-px text-[10px] font-semibold text-white">
    BOT
  </span>
);
const BOT_AVATAR = <Avatar label="H" tone="bg-primary !text-primary-foreground" />;

const MESSAGES: DemoMessage[] = [
  {
    id: 'm1',
    render: () => (
      <Line avatar={<Avatar label="ミ" tone="bg-rose-500" />} name="ミオ">
        今日もVCあつまろー！🎮
      </Line>
    ),
  },
  {
    id: 'm2',
    render: () => (
      <Line avatar={BOT_AVATAR} name="Herta" badge={BOT_BADGE}>
        <div className="mt-1 w-64 max-w-full rounded-xl border border-border border-l-4 border-l-primary bg-background/70 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            LEVEL UP!
          </p>
          <p className="mt-1 text-sm">ミオ が Lv.12 に到達しました 🎉</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
            <div className="lp-xp-fill h-full w-4/5 rounded-full bg-gradient-to-r from-primary to-fuchsia-500" />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">報酬ロール「常連」を付与</p>
        </div>
      </Line>
    ),
  },
  {
    id: 'm3',
    render: () => (
      <Line avatar={<Avatar label="タ" tone="bg-sky-500" />} name="タクミ">
        /team-split でチーム分けしよ！
      </Line>
    ),
  },
  {
    id: 'm4',
    render: () => (
      <Line avatar={BOT_AVATAR} name="Herta" badge={BOT_BADGE}>
        <div className="mt-1 grid w-64 max-w-full grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-2.5">
            <p className="font-semibold text-sky-500">TEAM A</p>
            <p className="mt-1 text-muted">ミオ / タクミ</p>
          </div>
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5">
            <p className="font-semibold text-rose-500">TEAM B</p>
            <p className="mt-1 text-muted">サクラ / リク</p>
          </div>
        </div>
      </Line>
    ),
  },
  {
    id: 'm5',
    render: () => (
      <div className="lp-msg flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
        <span>
          <strong className="font-semibold">Moderation</strong>{' '}
          スパムを検知し、メッセージを自動削除しました
        </span>
      </div>
    ),
  },
];

const STEP_MS = 1500;
const HOLD_MS = 3800;

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
      count >= MESSAGES.length ? HOLD_MS : count === 0 ? 700 : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [count, paused]);

  const typing = count > 0 && count < MESSAGES.length;

  return (
    <div className="relative">
      <div
        className="lp-float absolute -top-4 right-10 z-10 hidden items-center gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 text-xs font-semibold shadow-card backdrop-blur sm:flex"
        style={{ '--lp-rot': '-4deg', '--lp-delay': '0ms' } as CSSProperties}
      >
        <Sparkles className="h-4 w-4 text-amber-500" aria-hidden="true" />
        +25 XP
      </div>
      <div
        className="lp-float absolute -right-3 bottom-16 z-10 hidden items-center gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 text-xs font-semibold shadow-card backdrop-blur sm:flex"
        style={{ '--lp-rot': '3deg', '--lp-delay': '1200ms' } as CSSProperties}
      >
        <Crown className="h-4 w-4 text-primary" aria-hidden="true" />
        Achievement 解除
      </div>

      <div className="overflow-hidden rounded-3xl border border-border bg-surface/90 shadow-[0_30px_80px_-30px_hsl(var(--primary)/0.55)] backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <p className="ml-2 text-xs font-semibold text-muted"># general</p>
          <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
            デモ表示
          </span>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
            aria-label={paused ? 'デモの自動再生を再開' : 'デモの自動再生を一時停止'}
            className="lp-marquee-ctl flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {paused ? (
              <Play className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Pause className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
        </div>

        <div
          className="flex h-[26rem] flex-col justify-end gap-4 overflow-hidden px-4 py-4"
          aria-label="Hertaの動作デモ"
          role="img"
        >
          {MESSAGES.slice(0, count).map((message) => (
            <div key={message.id}>{message.render()}</div>
          ))}
          {typing ? (
            <div className="flex items-center gap-1 pl-12 text-muted" aria-hidden="true">
              <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
              <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
              <span className="lp-dot h-1.5 w-1.5 rounded-full bg-current" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
