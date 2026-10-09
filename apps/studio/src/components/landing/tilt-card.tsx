'use client';

import { useRef, type ReactNode } from 'react';

/**
 * マウスの位置に合わせて、面がわずかに傾き、反射が追従する。
 * タッチ操作・動きを減らす設定では何もしない。
 */
export function TiltCard({
  children,
  className = '',
  bracket,
}: {
  children: ReactNode;
  className?: string;
  /** ホバー時に四隅へ出るカッコの色 (面の色に合わせて、読める色を渡す) */
  bracket?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    el.classList.add('lp-tilting');
    el.style.setProperty('--rx', `${((0.5 - py) * 5).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((px - 0.5) * 6).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('lp-tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`lp-tilt ${className}`}
      style={bracket ? ({ '--bracket': bracket } as React.CSSProperties) : undefined}
    >
      {children}
      <span aria-hidden="true" className="lp-sheen" />
    </div>
  );
}
