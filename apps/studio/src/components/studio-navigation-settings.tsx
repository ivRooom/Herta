'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, LockKeyhole, ServerCog, SlidersHorizontal } from 'lucide-react';
import { useStudioNavigationContext } from '@/components/studio-navigation-context';
import { useStudioServerContext } from '@/components/studio-server-context';
import {
  STUDIO_PINNABLE_SERVER_TABS,
  type StudioPinnableServerTabId,
} from '@/lib/studio-navigation-config';

const CORE_SERVER_TABS = [
  ['Overview', 'サーバー概要'],
  ['Plugins', 'Plugin管理'],
  ['Commands', 'Slash Command一覧'],
  ['Community', 'Community機能'],
  ['Moderation', 'モデレーション'],
  ['Analytics / Insights', '利用状況・分析'],
] as const;

export function StudioNavigationSettings() {
  const { selectedGuild } = useStudioServerContext();
  const { visiblePluginTabIds, loadState, canManage, saveVisiblePluginTabIds, reload } =
    useStudioNavigationContext();
  const [draftIds, setDraftIds] = useState<StudioPinnableServerTabId[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftIds([...visiblePluginTabIds]);
    setMessage(null);
  }, [selectedGuild?.id, visiblePluginTabIds]);

  const dirty = useMemo(
    () =>
      draftIds.length !== visiblePluginTabIds.length ||
      draftIds.some((id, index) => id !== visiblePluginTabIds[index]),
    [draftIds, visiblePluginTabIds],
  );

  if (!selectedGuild) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-surface p-6">
        <div className="flex items-start gap-3">
          <ServerCog className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-medium">Server Switcherでサーバーを選択してください</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              個別Pluginタブの表示設定はサーバー単位で保存されます。
            </p>
          </div>
        </div>
      </section>
    );
  }

  const toggleTab = (id: StudioPinnableServerTabId) => {
    setMessage(null);
    setDraftIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return STUDIO_PINNABLE_SERVER_TABS.map((tab) => tab.id).filter((tabId) => next.has(tabId));
    });
  };

  const save = async () => {
    if (!dirty || !canManage || saving) return;
    setSaving(true);
    setMessage(null);
    const saved = await saveVisiblePluginTabIds(draftIds);
    setSaving(false);
    setMessage(saved ? 'タブ表示設定を保存しました' : 'タブ表示設定を保存できませんでした');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Server Navigation
            </div>
            <h2 className="mt-2 text-lg font-semibold">{selectedGuild.name}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              主要6タブは常に表示し、必要な個別PluginだけCurrent Serverへ追加できます。
            </p>
          </div>
          <span className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-muted">
            Server ID: {selectedGuild.id}
          </span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CORE_SERVER_TABS.map(([label, description]) => (
            <div key={label} className="flex items-start gap-2 rounded-xl border border-border bg-background p-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-0.5 text-xs text-muted">{description} · 常に表示</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div>
          <h2 className="font-medium">個別Pluginタブ</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            日常的に使う機能だけをCurrent Serverへ表示します。非表示にしてもページや機能は削除されません。
          </p>
        </div>

        {loadState === 'loading' ? (
          <p className="mt-5 rounded-xl border border-border bg-background p-4 text-sm text-muted" role="status">
            ナビゲーション設定を読み込んでいます…
          </p>
        ) : loadState === 'error' ? (
          <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-300">設定を読み込めませんでした。</p>
            <button
              type="button"
              onClick={reload}
              className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              再読み込み
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {STUDIO_PINNABLE_SERVER_TABS.map((tab) => {
              const checked = draftIds.includes(tab.id);
              return (
                <label
                  key={tab.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${
                    checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
                  } ${!canManage ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={checked}
                    onChange={() => toggleTab(tab.id)}
                    disabled={!canManage || loadState !== 'ready'}
                  />
                  <span>
                    <span className="block text-sm font-medium">{tab.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">{tab.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-xs leading-5 text-muted">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p>
              表示設定は権限付与ではありません。各ページ/APIのIAM認可は引き続きserver-sideで強制されます。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || !canManage || saving || loadState !== 'ready'}
            className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中…' : '表示設定を保存'}
          </button>
        </div>

        {!canManage && loadState === 'ready' ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            このサーバーのStudio表示設定を変更する権限がありません。
          </p>
        ) : null}
        <p className="mt-2 min-h-5 text-xs text-muted" role="status" aria-live="polite">
          {message ?? ''}
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-medium">将来のロール別表示</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Guild設定で選んだタブを基準に、将来admin.ivrm.jp側のロール設定でユーザーごとの表示候補を絞り込める境界を分離しています。表示可否に関係なく、実際の操作権限はHerta IAMで判定します。
        </p>
      </section>
    </div>
  );
}
