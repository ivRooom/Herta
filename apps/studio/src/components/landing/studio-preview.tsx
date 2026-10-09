'use client';

import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { BarChart3, Medal, Puzzle } from 'lucide-react';

const TABS = [
  { id: 'plugins', label: 'Plugin', icon: Puzzle },
  { id: 'analytics', label: '分析', icon: BarChart3 },
  { id: 'achievements', label: 'Achievements', icon: Medal },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PLUGINS = [
  { name: 'Moderation', desc: 'NGワード・スパム検知', on: true },
  { name: 'Auto Response', desc: 'キーワード自動応答', on: true },
  { name: 'LFG', desc: 'メンバー募集', on: true },
  { name: 'Team Split', desc: 'チーム分け', on: false },
  { name: 'Quote', desc: '名言の保存', on: true },
];

const BARS = [38, 52, 44, 68, 60, 82, 74, 91, 66, 78, 96, 88];

const BADGES = [
  { name: 'はじめの一歩', progress: 100 },
  { name: 'おしゃべり好き', progress: 72 },
  { name: 'VC常連', progress: 45 },
  { name: 'コミュニティの顔', progress: 18 },
];

/** Studio画面のイメージをタブで切り替えて見せる(表示用のダミーデータ)。 */
export function StudioPreview() {
  const [tab, setTab] = useState<TabId>('plugins');

  /** ARIA tabsパターンに沿った左右キー・Home/Endでのタブ移動 */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const nextId = TABS[next]!.id;
    setTab(nextId);
    document.getElementById(`studio-tab-${nextId}`)?.focus();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        className="flex flex-wrap items-center gap-1 border-b border-border p-2"
        role="tablist"
        aria-label="Studioの画面イメージ"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`studio-tab-${item.id}`}
              aria-controls="studio-tabpanel"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? 'bg-foreground text-background' : 'text-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
        <span className="ml-auto mr-2 text-[11px] text-muted">デモ表示</span>
      </div>

      {/* key でタブ切替のたびにアニメーションを再生する */}
      <div
        key={tab}
        id="studio-tabpanel"
        className="min-h-[18rem] p-5"
        role="tabpanel"
        aria-labelledby={`studio-tab-${tab}`}
      >
        {tab === 'plugins' ? (
          <ul className="space-y-2.5">
            {PLUGINS.map((plugin, index) => (
              <li
                key={plugin.name}
                className="lp-msg flex items-center gap-3 rounded-md border border-border bg-background px-4 py-3"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{plugin.name}</p>
                  <p className="text-xs text-muted">{plugin.desc}</p>
                </div>
                <span
                  className={`lp-switch relative h-6 w-11 shrink-0 rounded-full ${
                    plugin.on ? 'bg-primary' : 'bg-border'
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow ${
                      plugin.on ? 'translate-x-5' : ''
                    }`}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === 'analytics' ? (
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted">アクティブユーザー(イメージ)</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">DAU / WAU / MAU</p>
              </div>
              <span className="rounded-full px-0 py-1 text-xs font-semibold text-emerald-600">
                サンプル表示
              </span>
            </div>
            <div className="mt-6 flex h-44 items-end gap-2" aria-hidden="true">
              {BARS.map((height, index) => (
                <div
                  key={index}
                  className="lp-bar flex-1 rounded-t-sm bg-primary/80"
                  style={{ height: `${height}%`, '--lp-delay': `${index * 70}ms` } as CSSProperties}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              発言・リアクション・VC・オンライン時間を期間指定で集計
            </p>
          </div>
        ) : null}

        {tab === 'achievements' ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {BADGES.map((badge, index) => (
              <li
                key={badge.name}
                className="lp-msg rounded-md border border-border bg-background p-4"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-center gap-2">
                  <Medal
                    className={`h-4 w-4 ${badge.progress === 100 ? 'text-amber-500' : 'text-muted'}`}
                    aria-hidden="true"
                  />
                  <p className="text-sm font-semibold">{badge.name}</p>
                  <span className="ml-auto text-xs text-muted">{badge.progress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                  <div
                    className="lp-xp-fill h-full rounded-full bg-primary"
                    style={{
                      width: `${badge.progress}%`,
                      animationDelay: `${index * 100 + 200}ms`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
