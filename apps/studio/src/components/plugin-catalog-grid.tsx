'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Gamepad2,
  MessageCircleReply,
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  const categories = useMemo(() => {
    const unique = [...new Set(plugins.map((plugin) => plugin.category))].sort();
    return ['all', ...unique];
  }, [plugins]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return plugins.filter((plugin) => {
      if (category !== 'all' && plugin.category !== category) return false;
      if (onlyEnabled && !plugin.enabled) return false;
      if (!normalized) return true;
      return (
        plugin.name.toLocaleLowerCase('ja').includes(normalized) ||
        plugin.description.toLocaleLowerCase('ja').includes(normalized) ||
        plugin.id.toLocaleLowerCase('ja').includes(normalized)
      );
    });
  }, [category, onlyEnabled, plugins, query]);

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

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {categories.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
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
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          {filtered.length} / {plugins.length} Plugins
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
            return (
              <li
                key={plugin.id}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
              >
                <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-primary/0 blur-2xl transition-colors group-hover:bg-primary/10" />
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
                    guildId={guildId}
                    pluginId={plugin.id}
                    initialEnabled={plugin.enabled}
                    initialConfig={plugin.config}
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
