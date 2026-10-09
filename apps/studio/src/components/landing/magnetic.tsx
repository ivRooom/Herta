'use client';

import { useRef, type ReactNode } from 'react';

/**
 * 子要素(ボタンなど)が、カーソルが近づくと少しだけ吸い寄せられる。
 * タッチ操作・動きを減らす設定では何もしない。
 */
export function Magnetic({
  children,
  strength = 0.28,
}: {
  children: ReactNode;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  const onMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    el.classList.add('lp-magnet-active');
    el.style.setProperty('--tx', `${(dx * strength).toFixed(1)}px`);
    el.style.setProperty('--ty', `${(dy * strength).toFixed(1)}px`);
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('lp-magnet-active');
    el.style.setProperty('--tx', '0px');
    el.style.setProperty('--ty', '0px');
  };

  return (
    <span ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className="lp-magnet">
      {children}
    </span>
  );
}
