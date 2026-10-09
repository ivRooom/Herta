'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

/** カーソル位置に追従する光彩つきカード。 */
export function SpotlightCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const onMove = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };

  return (
    <article
      onMouseMove={onMove}
      className={`lp-spot rounded-2xl border border-border bg-surface/80 p-5 backdrop-blur-sm ${className}`}
      style={{ '--mx': '50%', '--my': '0%' } as CSSProperties}
    >
      {children}
    </article>
  );
}
