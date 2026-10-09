'use client';

import { useEffect, useRef, useState } from 'react';

const GLYPHS = '01<>/\\#$%&*+=?ABCDEF';

/**
 * 画面に入ると、文字が乱数から左へ順に読み取れる形へ整っていく(デコード演出)。
 * 初期表示は最終の文字なので、JS無効・動き低減では最初から読める。読み上げは常に元の文字。
 */
export function ScrambleText({
  text,
  delay = 0,
  durationMs = 700,
}: {
  text: string;
  delay?: number;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el || !text) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const root = el.closest<HTMLElement>('.lp-root');
    let frame = 0;
    let wait = 0;
    let cancelled = false;

    const run = () => {
      const start = performance.now() + delay;
      const tick = (now: number) => {
        if (cancelled) return;
        const p = Math.min(Math.max((now - start) / durationMs, 0), 1);
        if (p >= 1) {
          setDisplay(text);
          return;
        }
        const settled = Math.floor(p * text.length);
        setDisplay(
          Array.from(text)
            .map((char, i) =>
              i < settled || char === ' ' || char === '/' || char === '—'
                ? char
                : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!,
            )
            .join(''),
        );
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        // 読み込み表示が出ている間は待つ (最長8秒)
        const started = performance.now();
        const poll = () => {
          if (cancelled) return;
          if (!root?.classList.contains('lp-loading') || performance.now() - started > 8000) run();
          else wait = window.setTimeout(poll, 100);
        };
        poll();
      },
      { threshold: 0.6 },
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(wait);
      setDisplay(text);
    };
  }, [text, delay, durationMs]);

  return (
    <span ref={ref} aria-label={text}>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
