'use client';

import { useEffect, useRef } from 'react';

/**
 * スクロール量を CSS 変数としてページ全体へ渡す。
 *  --sp: 0〜1 のページ進捗 (上部の進捗バー)
 *  --sy: スクロール位置 (px)。.lp-par / .lp-band が視差・横流れに使う
 * 動きを減らす設定では何もしない (バーも視差も静止のまま)。
 */
export function ScrollFx() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = barRef.current?.closest<HTMLElement>('.lp-root');
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      root.style.setProperty('--sp', String(max > 0 ? Math.min(y / max, 1) : 0));
      root.style.setProperty('--sy', String(Math.round(y)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    root.classList.add('lp-fx');
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove('lp-fx');
    };
  }, []);

  return <div ref={barRef} aria-hidden="true" className="lp-progress" />;
}
