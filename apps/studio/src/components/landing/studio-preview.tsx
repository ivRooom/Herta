'use client';

import { useState, type CSSProperties } from 'react';
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

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface/90 shadow-card backdrop-blur-xl">
      <div className="flex items-center gap-1 border-b border-border p-2" role="tablist">
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-background'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
        <span className="ml-auto mr-2 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
          デモ表示
        </span>
      </div>

      {/* key でタブ切替のたびにアニメーションを再生する */}
      <div key={tab} className="min-h-[18rem] p-5" role="tabpanel">
        {tab === 'plugins' ? (
          <ul className="space-y-2.5">
            {PLUGINS.map((plugin, index) => (
              <li
                key={plugin.name}
                className="lp-msg flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3"
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
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-500">
                ▲ 成長中
              </span>
            </div>
            <div className="mt-6 flex h-44 items-end gap-2" aria-hidden="true">
              {BARS.map((height, index) => (
                <div
                  key={index}
                  className="lp-bar flex-1 rounded-t-lg bg-gradient-to-t from-primary/40 to-primary"
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
                className="lp-msg rounded-2xl border border-border bg-background/70 p-4"
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
                    className="lp-xp-fill h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500"
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
