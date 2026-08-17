'use client';

import { useId, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  List,
  LockKeyhole,
  Search,
  X,
} from 'lucide-react';
import {
  filterAndSortRoleInventory,
  paginateRoleInventory,
  summarizeRoleInventory,
  type RoleInventoryFilter,
  type RoleInventoryRole,
  type RoleInventorySort,
} from '@/lib/role-access-inventory';

export type RoleInventoryView = 'list' | 'grid';

export function RoleInventorySelector({
  roles,
  selectedRoleId,
  onSelect,
  configuredRoleIds,
  rootRoleId,
  title = 'Role inventory',
  description = 'Discord Roleを検索・絞り込みして、編集対象を選択します。',
  showSummary = true,
}: {
  roles: RoleInventoryRole[];
  selectedRoleId: string;
  onSelect: (roleId: string) => void;
  configuredRoleIds: readonly string[];
  rootRoleId: string;
  title?: string;
  description?: string;
  showSummary?: boolean;
}) {
  const headingId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoleInventoryFilter>('all');
  const [sort, setSort] = useState<RoleInventorySort>('hierarchy');
  const [view, setView] = useState<RoleInventoryView>('list');
  const [page, setPage] = useState(1);

  const configuredSet = useMemo(() => new Set(configuredRoleIds), [configuredRoleIds]);
  const summary = useMemo(
    () => summarizeRoleInventory(roles, configuredSet, rootRoleId),
    [configuredSet, roles, rootRoleId],
  );
  const filteredRoles = useMemo(
    () =>
      filterAndSortRoleInventory(roles, {
        query,
        filter,
        sort,
        configuredRoleIds: configuredSet,
        rootRoleId,
      }),
    [configuredSet, filter, query, roles, rootRoleId, sort],
  );
  const pageSize = view === 'grid' ? 12 : 18;
  const currentPage = useMemo(
    () => paginateRoleInventory(filteredRoles, page, pageSize),
    [filteredRoles, page, pageSize],
  );

  function resetPage() {
    setPage(1);
  }

  return (
    <section
      className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5"
      aria-labelledby={headingId}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p id={headingId} className="text-sm font-semibold">
            {title}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
        </div>
        <p className="shrink-0 text-xs text-muted" aria-live="polite">
          {currentPage.total === 0
            ? '0件'
            : `${currentPage.from}–${currentPage.to} / ${currentPage.total}件`}
        </p>
      </div>

      {showSummary ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InventoryMetric label="Discord Roles" value={summary.total} />
          <InventoryMetric label="Policy設定済み" value={summary.configured} />
          <InventoryMetric label="Policy未設定" value={summary.unconfigured} />
          <InventoryMetric label="Managed" value={summary.managed} />
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(14rem,1fr)_auto_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Roleを検索</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
            placeholder="Role名またはIDで検索"
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-sm outline-none transition focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                resetPage();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Role検索をクリア"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <label>
          <span className="sr-only">Role状態で絞り込み</span>
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as RoleInventoryFilter);
              resetPage();
            }}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto"
            aria-label="Role状態で絞り込み"
          >
            <option value="all">すべて</option>
            <option value="configured">Policy設定済み</option>
            <option value="unconfigured">Policy未設定</option>
            <option value="managed">Discord Managed</option>
            <option value="root">root</option>
          </select>
        </label>

        <label>
          <span className="sr-only">Roleの並び順</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as RoleInventorySort);
              resetPage();
            }}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto"
            aria-label="Roleの並び順"
          >
            <option value="hierarchy">Discord階層順</option>
            <option value="name">名前順</option>
            <option value="policy">Policy状態順</option>
          </select>
        </label>

        <div
          className="inline-flex h-10 rounded-xl border border-border bg-background p-1"
          role="group"
          aria-label="Role一覧の表示形式"
        >
          <ViewButton
            active={view === 'list'}
            label="リスト表示"
            onClick={() => {
              setView('list');
              resetPage();
            }}
          >
            <List className="h-4 w-4" aria-hidden="true" />
          </ViewButton>
          <ViewButton
            active={view === 'grid'}
            label="グリッド表示"
            onClick={() => {
              setView('grid');
              resetPage();
            }}
          >
            <Grid2X2 className="h-4 w-4" aria-hidden="true" />
          </ViewButton>
        </div>
      </div>

      <div className="mt-4">
        {currentPage.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-10 text-center">
            <p className="text-sm font-medium">条件に一致するRoleがありません</p>
            <p className="mt-1 text-xs text-muted">検索文字または絞り込み条件を変更してください。</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list" aria-label="Discord Role一覧">
            {currentPage.items.map((role) => (
              <div key={role.id} role="listitem">
                <RoleGridButton
                  role={role}
                  active={role.id === selectedRoleId}
                  root={role.id === rootRoleId}
                  configured={configuredSet.has(role.id)}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/40"
            role="list"
            aria-label="Discord Role一覧"
          >
            {currentPage.items.map((role) => (
              <div key={role.id} role="listitem">
                <RoleListButton
                  role={role}
                  active={role.id === selectedRoleId}
                  root={role.id === rootRoleId}
                  configured={configuredSet.has(role.id)}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {currentPage.pageCount > 1 ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            ページ {currentPage.page} / {currentPage.pageCount}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              前へ
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(currentPage.pageCount, current + 1))}
              disabled={currentPage.page >= currentPage.pageCount}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InventoryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

function RoleListButton({
  role,
  active,
  root,
  configured,
  onSelect,
}: {
  role: RoleInventoryRole;
  active: boolean;
  root: boolean;
  configured: boolean;
  onSelect: (roleId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(role.id)}
      aria-pressed={active}
      className={`grid w-full gap-3 px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${active ? 'bg-primary/10' : 'hover:bg-surface'}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <RoleColorSwatch color={role.color} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={`truncate text-sm font-medium ${active ? 'text-primary' : ''}`}>
              {role.name}
            </span>
            {root ? <StatusBadge label="root" icon="lock" /> : null}
            {!root && configured ? <StatusBadge label="Policy設定済み" icon="check" /> : null}
            {!root && !configured ? <StatusBadge label="Policy未設定" /> : null}
            {role.managed ? <StatusBadge label="Managed" icon="bot" /> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted">{role.id}</p>
        </div>
      </div>
      <p className="pl-7 text-xs text-muted sm:pl-0">Hierarchy #{role.position}</p>
    </button>
  );
}

function RoleGridButton({
  role,
  active,
  root,
  configured,
  onSelect,
}: {
  role: RoleInventoryRole;
  active: boolean;
  root: boolean;
  configured: boolean;
  onSelect: (roleId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(role.id)}
      aria-pressed={active}
      className={`h-full w-full rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/60 hover:border-primary/30 hover:bg-background'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RoleColorSwatch color={role.color} />
          <span className={`truncate text-sm font-semibold ${active ? 'text-primary' : ''}`}>
            {role.name}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-muted">#{role.position}</span>
      </div>
      <p className="mt-3 truncate font-mono text-[10px] text-muted">{role.id}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {root ? <StatusBadge label="root" icon="lock" /> : null}
        {!root && configured ? <StatusBadge label="Policy設定済み" icon="check" /> : null}
        {!root && !configured ? <StatusBadge label="Policy未設定" /> : null}
        {role.managed ? <StatusBadge label="Managed" icon="bot" /> : null}
      </div>
    </button>
  );
}

function RoleColorSwatch({ color }: { color: string }) {
  const safeColor = /^#[0-9a-fA-F]{6}$/u.test(color) ? color : undefined;
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/15 bg-muted/40 shadow-sm"
      style={safeColor ? { backgroundColor: safeColor } : undefined}
      aria-hidden="true"
    />
  );
}

function StatusBadge({ label, icon }: { label: string; icon?: 'lock' | 'check' | 'bot' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
      {icon === 'lock' ? <LockKeyhole className="h-3 w-3" aria-hidden="true" /> : null}
      {icon === 'check' ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      {icon === 'bot' ? <Bot className="h-3 w-3" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
