'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Boxes,
  CalendarDays,
  ChevronDown,
  Code2,
  Gamepad2,
  KeyRound,
  MessageCircleReply,
  PackageCheck,
  PackageSearch,
  Puzzle,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

export type PluginHubCatalogItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  authorName: string;
  authorUrl?: string;
  minHertaVersion?: string;
  permissions: Array<{ id: string; name: string; description: string }>;
  dependencies: Array<{ pluginId: string; optional?: boolean }>;
  events: string[];
  commands: Array<{ name: string; description: string }>;
  hasConfigSchema: boolean;
};

type SourceFilter = 'all' | 'official' | 'custom';

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
  core: 'Core',
  moderation: 'Moderation',
  utility: 'Utility',
  game: 'Game',
  fun: 'Fun',
  analytics: 'Analytics',
};

export function CustomPluginHubCatalog({ plugins }: { plugins: PluginHubCatalogItem[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState<SourceFilter>('all');

  const categories = useMemo(
    () => ['all', ...[...new Set(plugins.map((plugin) => plugin.category))].sort()],
    [plugins],
  );

  const filtered = useMemo(() => {
    if (source === 'custom') return [];
    const normalized = query.trim().toLocaleLowerCase('ja');
    return plugins.filter((plugin) => {
      if (category !== 'all' && plugin.category !== category) return false;
      if (!normalized) return true;
      return [
        plugin.id,
        plugin.name,
        plugin.description,
        plugin.authorName,
        ...plugin.permissions.flatMap((permission) => [permission.id, permission.name]),
      ].some((value) => value.toLocaleLowerCase('ja').includes(normalized));
    });
  }, [category, plugins, query, source]);

  const permissionCount = useMemo(
    () => new Set(plugins.flatMap((plugin) => plugin.permissions.map((permission) => permission.id))).size,
    [plugins],
  );
  const commandCount = useMemo(
    () => plugins.reduce((total, plugin) => total + plugin.commands.length, 0),
    [plugins],
  );

  const filtersActive = query || category !== 'all' || source !== 'all';

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Puzzle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Custom Plugin Hub
                </h1>
                <p className="mt-1 text-sm text-muted">
                  Herta Pluginの機能・権限・依存関係をインストール前に確認
                </p>
              </div>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
              現在はHerta本体へ静的登録された公式PluginをCatalogとして公開しています。Custom
              Registryは署名・権限境界・Runtime isolationが整うまで任意コードを受け入れません。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[21rem]">
            <SummaryMetric label="Official" value={`${plugins.length}`} />
            <SummaryMetric label="Commands" value={`${commandCount}`} />
            <SummaryMetric label="Permissions" value={`${permissionCount}`} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring xl:max-w-2xl">
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Plugin名・説明・ID・作者・要求権限を検索"
              aria-label="Plugin Catalogを検索"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
                aria-label="検索をクリア"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <div className="flex rounded-xl border border-border bg-background p-1" aria-label="Plugin種別">
            {(
              [
                ['all', 'すべて'],
                ['official', 'Official'],
                ['custom', 'Custom'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={source === value}
                onClick={() => setSource(value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  source === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Pluginカテゴリ">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                category === item
                  ? 'bg-primary/10 text-primary'
                  : 'bg-background text-muted hover:text-foreground'
              }`}
            >
              {CATEGORY_LABELS[item] ?? item}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          {source === 'custom' ? '0 Custom Plugins' : `${filtered.length} / ${plugins.length} Plugins`}
        </span>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategory('all');
              setSource('all');
            }}
            className="font-medium text-primary hover:underline"
          >
            フィルターを解除
          </button>
        ) : null}
      </div>

      {source === 'custom' ? (
        <CustomRegistryEmptyState />
      ) : filtered.length > 0 ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {filtered.map((plugin) => (
            <PluginCatalogCard key={plugin.id} plugin={plugin} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <PackageSearch className="mx-auto h-7 w-7 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">条件に一致するPluginがありません</p>
          <p className="mt-1 text-xs text-muted">検索語またはカテゴリを変更してください。</p>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
          <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Catalogは検証済みManifestのみ</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            この画面は `@herta/plugin-catalog`
            の静的Registryを直接利用します。DB内のpackage名や外部コードを評価して一覧を作ることはありません。
          </p>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
          <Boxes className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Guildへ適用する</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            公式Pluginの有効化・無効化とConfig Studioは既存のGuild Plugin Managerから操作できます。
          </p>
          <Link
            href="/dashboard/guilds"
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            Guildを選択 <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function PluginCatalogCard({ plugin }: { plugin: PluginHubCatalogItem }) {
  const Icon = PLUGIN_ICONS[plugin.id] ?? Puzzle;
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <article className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{plugin.name}</h2>
                <span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Official
                </span>
              </div>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
                {plugin.category} · v{plugin.version} · {plugin.id}
              </p>
            </div>
          </div>
          <PackageCheck className="h-5 w-5 shrink-0 text-emerald-500" aria-label="静的Registry登録済み" />
        </div>

        <p className="mt-4 text-sm leading-6 text-muted">{plugin.description}</p>

        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniMetric label="権限" value={`${plugin.permissions.length}`} />
          <MiniMetric label="Commands" value={`${plugin.commands.length}`} />
          <MiniMetric label="Events" value={`${plugin.events.length}`} />
          <MiniMetric label="Depends" value={`${plugin.dependencies.length}`} />
        </dl>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
          <span>Author: {plugin.authorName}</span>
          <span>Herta: {plugin.minHertaVersion ? `>= ${plugin.minHertaVersion}` : '互換指定なし'}</span>
          <span>Config: {plugin.hasConfigSchema ? 'Schemaあり' : '設定なし'}</span>
        </div>

        <details className="group mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
            Manifest詳細
            <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ManifestSection icon={KeyRound} title="Required permissions">
              {plugin.permissions.length > 0 ? (
                <ul className="space-y-2">
                  {plugin.permissions.map((permission) => (
                    <li key={permission.id} className="rounded-xl border border-border bg-background p-3">
                      <p className="text-xs font-semibold">{permission.name}</p>
                      <p className="mt-1 break-all text-[10px] text-muted">{permission.id}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{permission.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyManifestValue text="追加権限なし" />
              )}
            </ManifestSection>

            <ManifestSection icon={Boxes} title="Dependencies">
              {plugin.dependencies.length > 0 ? (
                <ul className="space-y-2 text-xs">
                  {plugin.dependencies.map((dependency) => (
                    <li key={dependency.pluginId} className="rounded-xl border border-border bg-background p-3">
                      <span className="font-medium">{dependency.pluginId}</span>
                      <span className="ml-2 text-muted">
                        {dependency.optional ? 'optional' : 'required'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyManifestValue text="依存Pluginなし" />
              )}
            </ManifestSection>

            <ManifestSection icon={Code2} title="Slash Commands">
              {plugin.commands.length > 0 ? (
                <ul className="space-y-2">
                  {plugin.commands.map((command) => (
                    <li key={command.name} className="rounded-xl border border-border bg-background p-3">
                      <code className="text-xs font-semibold text-primary">/{command.name}</code>
                      <p className="mt-1 text-xs leading-5 text-muted">{command.description}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyManifestValue text="Slash Commandなし" />
              )}
            </ManifestSection>

            <ManifestSection icon={Bot} title="Discord Events">
              {plugin.events.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {plugin.events.map((event) => (
                    <code
                      key={event}
                      className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted"
                    >
                      {event}
                    </code>
                  ))}
                </div>
              ) : (
                <EmptyManifestValue text="Event購読なし" />
              )}
            </ManifestSection>
          </div>
        </details>
      </article>
    </li>
  );
}

function ManifestSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyManifestValue({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted">{text}</p>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 px-3 py-3 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <dt className="text-[10px] font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function CustomRegistryEmptyState() {
  return (
    <section className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-7 sm:p-8">
      <div className="flex max-w-2xl flex-col items-start">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Custom Registryは安全基盤を構築中です</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Package署名、hash検証、要求権限の承認、互換Version、Runtime isolation、rollbackが揃うまで、外部PluginをBot本体へ直接ロードしません。
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted">
          {['Package signature', 'Permission approval', 'Dependency check', 'Runtime isolation'].map(
            (item) => (
              <span key={item} className="rounded-lg border border-border bg-background px-2.5 py-1.5">
                {item}
              </span>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
