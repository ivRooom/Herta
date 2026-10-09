'use client';

import { useRef, type ReactNode } from 'react';

/**
 * ヒーロー全体。マウスの周りの方眼だけが浅く光り(--mx/--my)、
 * 左下のHUDにカーソル座標が出る。タッチ操作では何もしない。
 */
export function HeroSpot({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    if (readoutRef.current) {
      readoutRef.current.textContent = `X ${String(Math.round(x)).padStart(4, '0')}  Y ${String(Math.round(y)).padStart(4, '0')}`;
    }
  };

  return (
    <section ref={ref} onPointerMove={onMove} className={`lp-hero relative ${className}`}>
      <div aria-hidden="true" className="lp-grid" />
      <div aria-hidden="true" className="lp-grid-lit" />
      <p
        aria-hidden="true"
        className="lp-mono pointer-events-none absolute bottom-4 left-5 z-10 hidden text-[10px] tracking-[0.2em] text-[var(--cyan)] opacity-80 sm:block lg:left-8"
      >
        <span className="opacity-60">CURSOR </span>
        <span ref={readoutRef}>X ---- Y ----</span>
      </p>
      {children}
    </section>
  );
}
