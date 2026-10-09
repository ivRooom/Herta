'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** 画面に入ってくるのに合わせて、中身が少し小さい状態から等倍まで大きくなる。 */
export function ScrollScale({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const start = window.innerHeight;
      const end = window.innerHeight * 0.3;
      const p = Math.min(Math.max((start - rect.top) / (start - end), 0), 1);
      el.style.setProperty('--s', String(0.9 + 0.1 * p));
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
    <div ref={ref} className="lp-scale">
      {children}
    </div>
  );
}
