'use client';

import { useEffect, useRef, useState } from 'react';

const SEEN_KEY = 'lp-seen';
/** 見せる最短時間。これより早く読み込めても、0→100%の流れは見せる。 */
const MIN_MS = 1700;
/** 読み込みが終わらなくても、これ以上は待たない。 */
const MAX_MS = 4500;

const STATUS = [
  { upTo: 30, label: 'INITIALIZING' },
  { upTo: 70, label: 'LOADING ASSETS' },
  { upTo: 99, label: 'ALMOST THERE' },
  { upTo: 100, label: 'READY' },
] as const;

/**
 * 0% → 100% と進む読み込み表示。初回のみ、画面全体を覆う。
 *
 * 数字は見た目の演出で、実際の読み込みと次のように連動する。
 *  - 通常は最短時間で 90% まで進み、フォントとページの読み込み完了を待つ。
 *  - 完了したら 100% まで進め、画面が上へ抜けて本体が現れる。
 * 同じタブでの2回目以降、動きを減らす設定、JS無効では表示しない
 * (表示の抑止は page.tsx のインラインスクリプトと landing.css が担う)。
 */
export function PageLoader() {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.lp-root');
    const finish = () => {
      root?.classList.remove('lp-loading');
      try {
        sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        // 保存できなくても動作には影響しない
      }
    };

    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // 読み取れない環境では、初回扱いにする
    }
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      seen ||
      root?.classList.contains('lp-seen')
    ) {
      finish();
      setGone(true);
      return;
    }

    let ready = false;
    const markReady = () => {
      ready = true;
    };
    const fonts = document.fonts?.ready ?? Promise.resolve();
    const loaded =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            window.addEventListener('load', () => resolve(), { once: true }),
          );
    void Promise.all([fonts, loaded]).then(markReady, markReady);

    const start = performance.now();
    let finishAt = 0;
    let frame = 0;
    const timers: number[] = [];

    const tick = (now: number) => {
      const elapsed = now - start;
      if (finishAt === 0) {
        // 最短時間をかけて 0 → 90% へ。以降は読み込み完了を待つ
        const t = Math.min(elapsed / MIN_MS, 1);
        const eased = 1 - Math.pow(1 - t, 2.2);
        setPct(Math.floor(eased * 90));
        if ((ready && elapsed >= MIN_MS) || elapsed >= MAX_MS) finishAt = now;
      } else {
        const t = Math.min((now - finishAt) / 450, 1);
        setPct(Math.floor(90 + t * 10));
        if (t >= 1) {
          setPct(100);
          timers.push(
            window.setTimeout(() => {
              finish();
              setLeaving(true);
              timers.push(window.setTimeout(() => setGone(true), 1400));
            }, 350),
          );
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  if (gone) return null;

  const status = STATUS.find((item) => pct <= item.upTo)?.label ?? 'READY';

  return (
    <div ref={ref} className={`lp-loader ${leaving ? 'lp-loader--out' : ''}`}>
      <span className="sr-only" role="status">
        読み込み中
      </span>
      <div aria-hidden="true" className="flex flex-col items-center gap-5">
        <p className="lp-loader-title">
          <span>NOW LOADING</span>
        </p>
        <p className="lp-loader-number">
          {pct}
          <small>%</small>
        </p>
        <div className="lp-loader-track">
          <div className="lp-loader-fill" style={{ ['--pct' as string]: pct / 100 }} />
        </div>
        <p className="lp-mono text-[11px] font-bold tracking-[0.25em] text-[var(--cyan)]">
          {status}
        </p>
      </div>
    </div>
  );
}
