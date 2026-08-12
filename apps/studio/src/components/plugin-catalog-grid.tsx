'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  CheckSquare2,
  Gamepad2,
  Loader2,
  MessageCircleReply,
  Power,
  PowerOff,
  Puzzle,
  Quote,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PluginToggle } from '@/components/plugin-toggle';

export type PluginCatalogItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

type BulkPluginResponse = {
  plugins?: Array<{
    manifest?: { id?: string };
    enabled?: boolean;
  }>;
  error?: unknown;
};

const PLUGIN_ICONS: Record<string, LucideIcon> = {
  moderation: ShieldCheck,
  'auto-response': MessageCircleReply,
  'daily-content': CalendarDays,
  lfg: UsersRound,
  quote: Quote,
  'team-split': Gamepad2,
};

const CATEGORY_LABELS: Record<string, string> = {
  all: 'すべて',
  moderation: 'Moderation',
  utility: 'Utility',
  game: 'Game',
  fun: 'Fun',
};

export function PluginCatalogGrid({
  guildId,
  plugins,
}: {
  guildId: string;
  plugins: PluginCatalogItem[];
}) {
  const [catalog, setCatalog] = useState(plugins);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  const categories = useMemo(() => {
    const unique = [...new Set(catalog.map((plugin) => plugin.category))].sort();
    return ['all', ...unique];
  }, [catalog]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return catalog.filter((plugin) => {
      if (category !== 'all' && plugin.category !== category) return false;
      if (onlyEnabled && !plugin.enabled) return false;
      if (!normalized) return true;
      return (
        plugin.name.toLocaleLowerCase('ja').includes(normalized) ||
        plugin.description.toLocaleLowerCase('ja').includes(normalized) ||
        plugin.id.toLocaleLowerCase('ja').includes(normalized)
      );
    });
  }, [catalog, category, onlyEnabled, query]);

  const selectedCount = selected.size;
  const filteredIds = useMemo(() => filtered.map((plugin) => plugin.id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((pluginId) => selected.has(pluginId));

  function handleEnabledChange(pluginId: string, enabled: boolean) {
    setCatalog((current) =>
      current.map((plugin) => (plugin.id === pluginId ? { ...plugin, enabled } : plugin)),
    );
  }

  function toggleSelected(pluginId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pluginId)) next.delete(pluginId);
      else next.add(pluginId);
      return next;
    });
    setBulkStatus('');
  }

  function toggleFilteredSelection() {
    setSelected((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredIds.forEach((pluginId) => next.delete(pluginId));
      else filteredIds.forEach((pluginId) => next.add(pluginId));
      return next;
    });
    setBulkStatus('');
  }

  async function applyBulkEnabled(enabled: boolean) {
    if (selected.size === 0 || bulkSaving) return;

    const pluginIds = [...selected];
    setBulkSaving(true);
    setBulkStatus(`${pluginIds.length}件を${enabled ? '有効化' : '無効化'}しています…`);

    try {
      const response = await fetch(`/api/guilds/${guildId}/plugins`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: pluginIds.map((pluginId) => ({ pluginId, enabled })),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as BulkPluginResponse;
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string' ? result.error : '一括更新に失敗しました',
        );
      }

      const enabledByPluginId = new Map<string, boolean>();
      for (const plugin of result.plugins ?? []) {
        const pluginId = plugin.manifest?.id;
        if (pluginId && typeof plugin.enabled === 'boolean') {
          enabledByPluginId.set(pluginId, plugin.enabled);
        }
      }

      setCatalog((current) =>
        current.map((plugin) => {
          const nextEnabled = enabledByPluginId.get(plugin.id);
          return nextEnabled === undefined ? plugin : { ...plugin, enabled: nextEnabled };
        }),
      );
      setSelected(new Set());
      setBulkStatus(`${pluginIds.length}件を${enabled ? '有効化' : '無効化'}しました`);
    } catch (error) {
      setBulkStatus(error instanceof Error ? error.message : '一括更新に失敗しました');
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring lg:max-w-xl">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Plugin名・説明・IDを検索"
              aria-label="Pluginを検索"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
                aria-label="検索をクリア"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <button
            type="button"
            aria-pressed={onlyEnabled}
            onClick={() => setOnlyEnabled((current) => !current)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
              onlyEnabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted hover:text-foreground'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" /> Activeのみ
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Pluginカテゴリ">
          {categories.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(item)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted hover:text-foreground'
                }`}
              >
                {CATEGORY_LABELS[item] ?? item}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFilteredSelection}
              disabled={filteredIds.length === 0 || bulkSaving}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckSquare2 className="h-4 w-4" />
              {allFilteredSelected ? '表示中の選択を解除' : '表示中をすべて選択'}
            </button>
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  setBulkStatus('');
                }}
                disabled={bulkSaving}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
              >
                選択解除
              </button>
            ) : null}
            <span className="text-xs text-muted">{selectedCount}件選択中</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selectedCount === 0 || bulkSaving}
              onClick={() => applyBulkEnabled(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              選択したPluginを有効化
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || bulkSaving}
              onClick={() => applyBulkEnabled(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold transition-colors hover:border-red-400/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PowerOff className="h-4 w-4" /> 選択したPluginを無効化
            </button>
          </div>
        </div>

        {bulkStatus ? (
          <p
            className={`mt-3 text-xs ${
              bulkStatus.includes('失敗') || bulkStatus.includes('不正')
                ? 'text-red-400'
                : 'text-muted'
            }`}
            role="status"
          >
            {bulkStatus}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          {filtered.length} / {catalog.length} Plugins
        </span>
        {query || category !== 'all' || onlyEnabled ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategory('all');
              setOnlyEnabled(false);
            }}
            className="font-medium text-primary hover:underline"
          >
            フィルターを解除
          </button>
        ) : null}
      </div>

      {filtered.length > 0 ? (
        <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((plugin) => {
            const Icon = PLUGIN_ICONS[plugin.id] ?? Puzzle;
            const checked = selected.has(plugin.id);
            return (
              <li
                key={plugin.id}
                className={`group relative overflow-hidden rounded-2xl border bg-surface p-5 shadow-card transition-colors ${
                  checked
                    ? 'border-primary/60 ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-primary/0 blur-2xl transition-colors group-hover:bg-primary/10" />
                <div className="relative mb-4 flex items-center justify-between gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-muted hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={bulkSaving}
                      onChange={() => toggleSelected(plugin.id)}
                      className="h-4 w-4 rounded border-border accent-current"
                    />
                    一括操作に選択
                  </label>
                  {checked ? (
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                      選択中
                    </span>
                  ) : null}
                </div>

                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/guilds/${guildId}/plugins/${plugin.id}`}
                        className="font-semibold hover:text-primary"
                      >
                        {plugin.name}
                      </Link>
                      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                        {plugin.category} · v{plugin.version}
                      </p>
                    </div>
                  </div>
                  <PluginToggle
                    key={`${plugin.id}:${plugin.enabled}`}
                    guildId={guildId}
                    pluginId={plugin.id}
                    initialEnabled={plugin.enabled}
                    initialConfig={plugin.config}
                    disabled={bulkSaving}
                    ariaLabel={`${plugin.name}の有効状態を切り替え`}
                    onEnabledChange={(enabled) => handleEnabledChange(plugin.id, enabled)}
                  />
                </div>

                <p className="mt-4 min-h-12 text-sm leading-6 text-muted">{plugin.description}</p>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      plugin.enabled
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-background text-muted'
                    }`}
                  >
                    {plugin.enabled ? 'Active' : 'Disabled'}
                  </span>
                  <Link
                    href={`/dashboard/guilds/${guildId}/plugins/${plugin.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
                  >
                    <Settings className="h-3.5 w-3.5" /> 設定
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <Search className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-3 text-sm font-medium">条件に一致するPluginがありません</p>
          <p className="mt-1 text-xs text-muted">検索語またはカテゴリを変更してください。</p>
        </div>
      )}
    </div>
  );
}
