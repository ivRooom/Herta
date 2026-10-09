'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** 出現を遅らせるミリ秒 (連続表示のずらし用) */
  delay?: number;
  className?: string;
}

/** ビューポートに入ったらフェード+スライドで表示する。 */
export function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    // JS無効・ハイドレーション失敗時でも本文を読めるよう、SSR時点では表示状態にしておく。
    // マウント後、まだ画面外にある要素だけを隠してスクロールで出現させる。
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setShown(true);
      return;
    }
    setArmed(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lp-reveal ${armed ? 'lp-armed' : ''} ${shown ? 'lp-in' : ''} ${className}`}
      style={{ '--lp-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
