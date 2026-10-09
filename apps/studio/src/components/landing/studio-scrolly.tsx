'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StudioPreview, TABS, type TabId } from './studio-preview';

const CAPTIONS: Record<TabId, string> = {
  plugins: '必要な機能を、トグルでON/OFF',
  analytics: 'サーバーの活動を、期間を決めて集計',
  achievements: '実績の達成状況を、メンバーごとに確認',
};

/**
 * Studioの紹介。画面幅が広く、動き低減設定でない場合に限り、
 * セクションの中でスクロールするとプレビューのタブが順に切り替わる。
 * 上記以外(スマホ・動き低減・JS無効)では、通常のタブ操作だけのシンプルな表示になる。
 * タブは手動でも切り替えられ、手動で選んだ間はスクロールでは上書きしない。
 */
export function StudioScrolly({ children }: { children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  const manualRef = useRef(false);
  const [tab, setTab] = useState<TabId>('plugins');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const evaluate = () => setEnabled(wide.matches && !reduced.matches);
    evaluate();
    wide.addEventListener('change', evaluate);
    reduced.addEventListener('change', evaluate);
    return () => {
      wide.removeEventListener('change', evaluate);
      reduced.removeEventListener('change', evaluate);
    };
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!enabled || !section) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      const progress = -rect.top / total;
      // セクションが画面から完全に出たら、手動選択を解除して次回に備える。
      // (画面内に見えている間は、キーボード操作などで選んだタブを維持する)
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) manualRef.current = false;
      if (manualRef.current) return;
      const index = Math.min(TABS.length - 1, Math.max(0, Math.floor(progress * TABS.length)));
      setTab(TABS[index]!.id);
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
  }, [enabled]);

  return (
    <section
      id="studio"
      ref={sectionRef}
      className={`scroll-mt-4 bg-black text-white ${enabled ? 'h-[250vh]' : ''}`}
    >
      <div className={enabled ? 'sticky top-0 flex h-screen items-center' : ''}>
        <div
          className={`mx-auto grid w-full max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-8 ${
            enabled ? 'py-8' : 'py-24'
          }`}
        >
          <div>
            {children}
            <ol className="mt-10 space-y-1 border-l border-white/15">
              {TABS.map((item) => {
                const active = tab === item.id;
                return (
                  <li
                    key={item.id}
                    aria-current={active ? 'step' : undefined}
                    className={`-ml-px border-l-2 py-1.5 pl-4 text-base font-medium transition-colors duration-500 ${
                      active ? 'border-white text-white' : 'border-transparent text-[var(--muted)]'
                    }`}
                  >
                    {CAPTIONS[item.id]}
                  </li>
                );
              })}
            </ol>
            {enabled ? (
              <p className="mt-6 text-xs text-[var(--muted)]">
                スクロールすると、右の画面が切り替わります。
              </p>
            ) : null}
          </div>
          <div className="text-[var(--ink)]">
            <StudioPreview
              tab={tab}
              onTabChange={(next) => {
                manualRef.current = true;
                setTab(next);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
