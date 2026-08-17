'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search, TerminalSquare } from 'lucide-react';
import type {
  BotCommandCatalogEntry,
  BotCommandCatalogOption,
  BotCommandCatalogSource,
} from '@/lib/bot-command-catalog';

export function CommandCatalog({ commands }: { commands: BotCommandCatalogEntry[] }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | BotCommandCatalogSource>('all');
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      commands.filter((command) => {
        if (source !== 'all' && command.source !== source) return false;
        if (!normalizedQuery) return true;
        return (
          command.name.includes(normalizedQuery) ||
          command.description.toLowerCase().includes(normalizedQuery) ||
          command.options.some((option) => optionMatches(option, normalizedQuery))
        );
      }),
    [commands, normalizedQuery, source],
  );

  const coreCount = commands.filter((command) => command.source === 'core').length;
  const pluginCount = commands.length - coreCount;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Command集計">
        <StatCard label="登録済み" value={commands.length} detail="Discord Guild Command" />
        <StatCard label="Core" value={coreCount} detail="Herta標準Command" />
        <StatCard label="Plugin" value={pluginCount} detail="有効Plugin由来" />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block flex-1">
            <span className="sr-only">Commandを検索</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前・説明・オプションで検索"
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <div className="inline-flex rounded-xl border border-border bg-background p-1" aria-label="所有元で絞り込み">
            {(
              [
                ['all', 'すべて'],
                ['core', 'Core'],
                ['plugin', 'Plugin'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={source === value}
                onClick={() => setSource(value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  source === value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted hover:bg-surface hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted" aria-live="polite">
          {filtered.length} / {commands.length} commands
        </p>
      </section>

      {filtered.length > 0 ? (
        <section className="grid gap-3" aria-label="Command一覧">
          {filtered.map((command) => (
            <CommandCard key={command.id} command={command} />
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center">
          <Search className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">一致するCommandがありません</h2>
          <p className="mt-1 text-sm text-muted">検索語または所有元フィルターを変更してください。</p>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function CommandCard({ command }: { command: BotCommandCatalogEntry }) {
  const usages = buildUsage(command);
  return (
    <details className="group rounded-2xl border border-border bg-surface shadow-card open:border-primary/30">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <TerminalSquare className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <code className="font-semibold text-foreground">/{command.name}</code>
            <SourceBadge source={command.source} />
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              Discord登録済み
            </span>
          </span>
          <span className="mt-1 block text-sm leading-6 text-muted">{command.description}</span>
        </span>
        <ChevronDown
          className="mt-1 h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="border-t border-border px-4 py-4 sm:px-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">使い方</h3>
            <div className="mt-2 space-y-2">
              {usages.map((usage) => (
                <code
                  key={usage}
                  className="block overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 text-xs"
                >
                  {usage}
                </code>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              オプション / サブコマンド
            </h3>
            {command.options.length > 0 ? (
              <div className="mt-2 space-y-2">
                {command.options.map((option) => (
                  <OptionRow key={`${option.type}:${option.name}`} option={option} depth={0} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">オプションはありません。</p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function SourceBadge({ source }: { source: BotCommandCatalogSource }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        source === 'core'
          ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
          : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
      }`}
    >
      {source === 'core' ? 'Core' : 'Plugin'}
    </span>
  );
}

function OptionRow({ option, depth }: { option: BotCommandCatalogOption; depth: number }) {
  const isContainer = option.type === 'subcommand' || option.type === 'subcommand-group';
  return (
    <div
      className="rounded-xl border border-border bg-background px-3 py-3"
      style={{ marginLeft: Math.min(depth, 2) * 12 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-semibold">{option.name}</code>
        <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {option.type}
        </span>
        {!isContainer ? (
          <span className="text-[10px] font-medium text-muted">
            {option.required ? '必須' : '任意'}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{option.description}</p>
      {option.choices?.length ? (
        <p className="mt-1 text-[11px] text-muted">
          選択肢: {option.choices.map((choice) => choice.name).join(' / ')}
        </p>
      ) : null}
      {option.minValue !== undefined || option.maxValue !== undefined ? (
        <p className="mt-1 text-[11px] text-muted">
          範囲: {option.minValue ?? '−∞'} ～ {option.maxValue ?? '∞'}
        </p>
      ) : null}
      {option.options?.length ? (
        <div className="mt-2 space-y-2">
          {option.options.map((child) => (
            <OptionRow key={`${child.type}:${child.name}`} option={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildUsage(command: BotCommandCatalogEntry): string[] {
  const containers = command.options.filter(
    (option) => option.type === 'subcommand' || option.type === 'subcommand-group',
  );
  if (containers.length === 0) {
    return [`/${command.name}${formatOptionUsage(command.options)}`];
  }

  const usages: string[] = [];
  for (const option of containers) {
    if (option.type === 'subcommand') {
      usages.push(`/${command.name} ${option.name}${formatOptionUsage(option.options ?? [])}`);
      continue;
    }
    for (const child of option.options ?? []) {
      if (child.type !== 'subcommand') continue;
      usages.push(
        `/${command.name} ${option.name} ${child.name}${formatOptionUsage(child.options ?? [])}`,
      );
    }
  }
  return usages.length > 0 ? usages : [`/${command.name}`];
}

function formatOptionUsage(options: BotCommandCatalogOption[]): string {
  const values = options
    .filter((option) => option.type !== 'subcommand' && option.type !== 'subcommand-group')
    .map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`));
  return values.length > 0 ? ` ${values.join(' ')}` : '';
}

function optionMatches(option: BotCommandCatalogOption, query: string): boolean {
  return (
    option.name.includes(query) ||
    option.description.toLowerCase().includes(query) ||
    option.options?.some((child) => optionMatches(child, query)) === true
  );
}
