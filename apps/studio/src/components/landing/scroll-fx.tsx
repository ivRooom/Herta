'use client';

import { useEffect, useRef } from 'react';

/**
 * スクロール量をCSS変数 (--sy, --sp) としてページのルートへ流す。
 * 上部の進捗バーと、ヒーローの視差が参照する。
 * 動き低減設定ではリスナーを張らず、変数は初期値(0)のまま = 全て静止する。
 */
export function ScrollFx() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('.lp-root');
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      root.style.setProperty('--sy', String(Math.min(y, 1200)));
      root.style.setProperty('--sp', String(max > 0 ? Math.min(y / max, 1) : 0));
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

  return <div ref={ref} className="lp-progress" aria-hidden="true" />;
}
