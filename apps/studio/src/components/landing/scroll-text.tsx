'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * スクロールに合わせて、文字が1文字ずつ淡いグレーから黒へ変わる大きな文章。
 * 初期値は全文が濃い状態なので、JS無効・動きを減らす設定でもそのまま読める。
 */
export function ScrollText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [progress, setProgress] = useState(1);
  const chars = Array.from(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      // 画面の下端付近で0、上から35%付近に来たら1
      const start = window.innerHeight * 0.9;
      const end = window.innerHeight * 0.35;
      setProgress(Math.min(Math.max((start - rect.top) / (start - end), 0), 1));
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
    <p ref={ref} aria-label={text}>
      {chars.map((char, index) => {
        const reached = progress * (chars.length + 6) > index;
        return (
          <span
            key={index}
            aria-hidden="true"
            className="lp-word"
            style={{ color: reached ? 'var(--ink)' : 'var(--faint)' }}
          >
            {char}
          </span>
        );
      })}
    </p>
  );
}
