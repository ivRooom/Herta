'use client';

import { useRef, type ReactNode } from 'react';

/** ヒーロー全体。マウスの周りの方眼だけが浅く光る(--mx/--my を方眼レイヤーへ渡す)。 */
export function HeroSpot({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };

  return (
    <section ref={ref} onPointerMove={onMove} className={`lp-hero relative ${className}`}>
      <div aria-hidden="true" className="lp-grid" />
      <div aria-hidden="true" className="lp-grid-lit" />
      {children}
    </section>
  );
}
