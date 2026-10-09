'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface Step {
  title: string;
  body: string;
  color: string;
}

/** スクロールに合わせて縦線が伸び、到達したステップの丸が色づくタイムライン。 */
export function StepsProgress({ steps }: { steps: readonly Step[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  // 初期値は1(= 全て到達済み)。JS無効・動き低減でもそのまま全体が読める。
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = list.getBoundingClientRect();
      // 画面の6割あたりを「読んでいる位置」として、リストを通過した割合を出す
      const raw = (window.innerHeight * 0.6 - rect.top) / rect.height;
      setProgress(Math.min(Math.max(raw, 0), 1));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ol
      ref={listRef}
      className="relative mt-10 space-y-6 pl-16"
      style={{ '--p': progress } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute bottom-6 left-[1.4rem] top-6 w-[3px] rounded-full bg-[var(--ink)]/15"
      />
      <span
        aria-hidden="true"
        className="lp-line-fill absolute bottom-6 left-[1.4rem] top-6 w-[3px] rounded-full bg-[var(--purple)]"
      />
      {steps.map((step, index) => {
        const reached = progress >= index / (steps.length - 1) - 0.04;
        return (
          <li key={step.title} className="relative">
            <span
              data-reached={reached}
              className="lp-step-dot absolute -left-16 top-4 flex h-11 w-11 items-center justify-center rounded-full border-2 border-[var(--ink)] text-lg font-extrabold"
              style={{ backgroundColor: reached ? step.color : '#ffffff' }}
            >
              {index + 1}
            </span>
            <div className="pop rounded-2xl bg-white p-5">
              <h3 className="text-lg font-extrabold">{step.title}</h3>
              <p className="mt-1.5 text-sm font-medium leading-7">{step.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
