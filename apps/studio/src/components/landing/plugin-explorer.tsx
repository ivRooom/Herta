'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

export interface ExplorerPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  commandCount: number;
}

export interface ExplorerCategory {
  id: string;
  label: string;
}

/** 公式Pluginカタログの全件を、検索とカテゴリで絞り込めるようにした一覧。 */
export function PluginExplorer({
  plugins,
  categories,
}: {
  plugins: readonly ExplorerPlugin[];
  categories: readonly ExplorerCategory[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: plugins.length };
    for (const plugin of plugins) result[plugin.category] = (result[plugin.category] ?? 0) + 1;
    return result;
  }, [plugins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins.filter((plugin) => {
      if (category !== 'all' && plugin.category !== category) return false;
      if (!q) return true;
      return (
        plugin.name.toLowerCase().includes(q) ||
        plugin.id.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q)
      );
    });
  }, [plugins, query, category]);

  const label = (id: string) => categories.find((item) => item.id === id)?.label ?? id;

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="カテゴリ">
          {[{ id: 'all', label: 'すべて' }, ...categories]
            .filter((item) => item.id === 'all' || (counts[item.id] ?? 0) > 0)
            .map((item) => {
              const selected = category === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategory(item.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] ${
                    selected
                      ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                      : 'border-[var(--line)] text-[var(--muted)] hover:border-white/25 hover:text-[var(--ink)]'
                  }`}
                >
                  {item.label}
                  <span className="lp-mono ml-1.5 opacity-60">{counts[item.id] ?? 0}</span>
                </button>
              );
            })}
        </div>
        <label className="relative block md:w-72">
          <span className="sr-only">Pluginを検索</span>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pluginを検索…"
            className="w-full rounded-full border border-[var(--line)] bg-[var(--surface)] py-2 pl-10 pr-4 text-sm outline-none transition placeholder:text-[#6d6d76] focus:border-[var(--purple)]"
          />
        </label>
      </div>

      <p className="lp-mono mt-5 text-xs text-[var(--muted)]" role="status" aria-live="polite">
        {filtered.length} / {plugins.length} PLUGINS
      </p>

      <ul className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((plugin, position) => (
          <li
            key={plugin.id}
            className="lp-card-in bg-[var(--surface)] p-5 transition-colors hover:bg-[var(--surface-2)]"
            style={{ animationDelay: `${Math.min(position, 12) * 25}ms` }}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold leading-snug">{plugin.name}</h3>
              <span className="lp-mono shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                {label(plugin.category)}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-[var(--muted)]">
              {plugin.description}
            </p>
            <p className="lp-mono mt-3 text-[11px] text-[#85858f]">
              {plugin.id}
              {plugin.commandCount > 0 ? ` · ${plugin.commandCount} cmd` : ''}
            </p>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="bg-[var(--surface)] p-8 text-sm text-[var(--muted)] sm:col-span-2 lg:col-span-3">
            条件に合うPluginがありません。
          </li>
        ) : null}
      </ul>
    </div>
  );
}
