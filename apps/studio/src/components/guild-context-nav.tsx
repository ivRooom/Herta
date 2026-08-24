'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  History,
  LayoutDashboard,
  Plug,
  Search,
  ServerCog,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { GuildAvatar } from '@/components/guild-avatar';
import { useStudioServerContext, type StudioServerItem } from '@/components/studio-server-context';
import {
  getGuildConsoleContext,
  getGuildConsoleHref,
  getGuildSwitchHref,
  type GuildConsoleSection,
} from '@/lib/guild-context-nav';

type Variant = 'desktop' | 'mobile';

export type GuildSwitcherState = 'ready' | 'reconnect-required' | 'unavailable';
export type GuildSwitcherItem = StudioServerItem;

type QuickNavItem = {
  section: Exclude<GuildConsoleSection, 'other'>;
  label: string;
  icon: LucideIcon;
};

const QUICK_NAV_ITEMS: QuickNavItem[] = [
  { section: 'overview', label: '概要', icon: LayoutDashboard },
  { section: 'plugins', label: 'Plugin設定', icon: Plug },
  { section: 'audit-logs', label: '監査ログ', icon: History },
];

const SEARCH_THRESHOLD = 6;

export function GuildContextNav({
  variant,
  guildsState,
}: {
  variant: Variant;
  guildsState: GuildSwitcherState;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const routeContext = getGuildConsoleContext(pathname);
  const { guilds, selectedGuild, defaultGuildId, selectGuild, setDefaultGuild } =
    useStudioServerContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = `guild-context-menu-${variant}`;
  const searchId = `guild-switcher-search-${variant}`;

  const normalizedQuery = query.trim().toLocaleLowerCase('ja');
  const switchCandidates = guilds.filter((guild) => {
    if (guild.id === selectedGuild?.id) return false;
    if (!normalizedQuery) return true;
    return (
      guild.name.toLocaleLowerCase('ja').includes(normalizedQuery) ||
      guild.id.includes(normalizedQuery)
    );
  });

  useEffect(() => {
    setMenuOpen(false);
    setQuery('');
    setPreferenceMessage(null);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  function handleGuildSelect(guild: StudioServerItem) {
    if (!selectGuild(guild.id)) return;
    setMenuOpen(false);
    setQuery('');
    if (routeContext) {
      router.push(getGuildSwitchHref(guild.id, routeContext));
      return;
    }
    if (pathname === '/dashboard/community' || pathname === '/dashboard/analytics') {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set('guild', guild.id);
      nextSearchParams.delete('page');
      router.push(`${pathname}?${nextSearchParams.toString()}`);
    }
  }

  async function handleDefaultToggle() {
    if (!selectedGuild || preferenceSaving) return;
    const nextDefaultGuildId = defaultGuildId === selectedGuild.id ? null : selectedGuild.id;
    setPreferenceSaving(true);
    setPreferenceMessage(null);
    try {
      const saved = await setDefaultGuild(nextDefaultGuildId);
      setPreferenceMessage(
        saved
          ? nextDefaultGuildId
            ? 'このサーバーをデフォルトに設定しました'
            : 'デフォルトサーバーを解除しました'
          : 'デフォルトサーバーを保存できませんでした',
      );
    } finally {
      setPreferenceSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div ref={menuRef} className="relative min-w-0">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen((current) => !current)}
          className={`inline-flex items-center gap-2 rounded-xl border transition-colors ${
            variant === 'desktop'
              ? 'h-10 max-w-56 bg-surface px-2.5 text-xs font-semibold'
              : 'h-9 max-w-40 bg-surface px-2 text-xs font-semibold'
          } ${
            menuOpen
              ? 'border-primary/30 text-primary'
              : 'border-border text-muted hover:text-foreground'
          }`}
        >
          {selectedGuild ? (
            <span className="shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
              <GuildAvatar name={selectedGuild.name} iconUrl={selectedGuild.iconUrl} size={24} />
            </span>
          ) : (
            <ServerCog className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span className={`truncate ${variant === 'mobile' ? 'hidden sm:inline' : ''}`}>
            {selectedGuild?.name ?? (guilds.length > 0 ? 'サーバーを選択' : 'サーバー')}
          </span>
          {selectedGuild && defaultGuildId === selectedGuild.id ? (
            <Star
              className="h-3 w-3 shrink-0 fill-current text-amber-400"
              aria-label="デフォルト"
              role="img"
            />
          ) : null}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {menuOpen ? (
          <div
            id={menuId}
            role="dialog"
            aria-label="サーバー切替"
            className={`absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-xl ${
              variant === 'mobile' ? 'top-9' : 'top-10'
            }`}
          >
            <div className="px-2.5 pb-2 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Selected Server
              </p>
              {selectedGuild ? (
                <div className="mt-2 rounded-xl bg-primary/5 p-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 overflow-hidden rounded-xl" aria-hidden="true">
                      <GuildAvatar
                        name={selectedGuild.name}
                        iconUrl={selectedGuild.iconUrl}
                        size={36}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{selectedGuild.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted">ナビゲーションの操作対象</p>
                    </div>
                    <Check
                      className="h-4 w-4 shrink-0 text-primary"
                      aria-label="選択中"
                      role="img"
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={defaultGuildId === selectedGuild.id}
                    onClick={() => void handleDefaultToggle()}
                    disabled={preferenceSaving}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${
                        defaultGuildId === selectedGuild.id ? 'fill-current text-amber-400' : ''
                      }`}
                      aria-hidden="true"
                    />
                    {defaultGuildId === selectedGuild.id
                      ? 'デフォルトサーバーを解除'
                      : 'デフォルトサーバーに設定'}
                  </button>
                  <p
                    className="mt-2 text-center text-[10px] text-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {preferenceMessage ?? ''}
                  </p>
                </div>
              ) : null}
            </div>

            {selectedGuild ? (
              <nav className="mb-2 grid grid-cols-3 gap-1" aria-label="選択中サーバー管理">
                {QUICK_NAV_ITEMS.map((item) => (
                  <QuickNavLink
                    key={item.section}
                    item={item}
                    guildId={selectedGuild.id}
                    routeContext={routeContext}
                    compact
                  />
                ))}
              </nav>
            ) : null}

            <div className="border-t border-border pt-2">
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <p className="text-xs font-semibold">操作対象を切り替える</p>
                {guildsState === 'ready' ? (
                  <span className="text-[10px] tabular-nums text-muted">
                    {guilds.length} servers
                  </span>
                ) : null}
              </div>

              {guildsState === 'ready' && guilds.length >= SEARCH_THRESHOLD ? (
                <div className="relative mx-2 mt-1">
                  <label htmlFor={searchId} className="sr-only">
                    サーバーを検索
                  </label>
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                    aria-hidden="true"
                  />
                  <input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value.slice(0, 100))}
                    placeholder="名前・Server IDで検索"
                    autoComplete="off"
                    className="h-9 w-full rounded-xl border border-border bg-background pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted focus:border-primary"
                  />
                </div>
              ) : null}

              <div className="mt-1 max-h-64 overflow-y-auto px-1">
                <GuildListState
                  guildsState={guildsState}
                  guilds={guilds}
                  candidates={switchCandidates}
                  selectedGuild={selectedGuild}
                  defaultGuildId={defaultGuildId}
                  hasQuery={normalizedQuery.length > 0}
                  onSelect={handleGuildSelect}
                />
              </div>
            </div>

            <div className="mt-2 border-t border-border pt-2">
              <Link
                href="/dashboard/guilds"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <ServerCog className="h-4 w-4" aria-hidden="true" />
                サーバー一覧を開く
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {variant === 'desktop' && selectedGuild ? (
        <nav
          className="flex min-w-0 items-center gap-1 rounded-xl border border-border bg-surface p-1"
          aria-label="選択中サーバー管理"
        >
          {QUICK_NAV_ITEMS.map((item) => (
            <QuickNavLink
              key={item.section}
              item={item}
              guildId={selectedGuild.id}
              routeContext={routeContext}
            />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function GuildListState({
  guildsState,
  guilds,
  candidates,
  selectedGuild,
  defaultGuildId,
  hasQuery,
  onSelect,
}: {
  guildsState: GuildSwitcherState;
  guilds: readonly StudioServerItem[];
  candidates: readonly StudioServerItem[];
  selectedGuild: StudioServerItem | null;
  defaultGuildId: string | null;
  hasQuery: boolean;
  onSelect: (guild: StudioServerItem) => void;
}) {
  if (guildsState === 'reconnect-required') {
    return (
      <p className="rounded-xl px-2.5 py-3 text-xs leading-5 text-muted">
        Discordとの接続を更新すると、管理可能なサーバーをここから切り替えられます。
      </p>
    );
  }

  if (guildsState === 'unavailable') {
    return (
      <p className="rounded-xl px-2.5 py-3 text-xs leading-5 text-muted">
        サーバー一覧を取得できませんでした。サーバー一覧画面から再試行してください。
      </p>
    );
  }

  if (guilds.length === 0) {
    return (
      <p className="rounded-xl px-2.5 py-3 text-xs leading-5 text-muted">
        管理可能なDiscordサーバーがありません。
      </p>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-xl px-2.5 py-3 text-xs leading-5 text-muted">
        {hasQuery
          ? '検索条件に一致するサーバーがありません。'
          : selectedGuild
            ? 'ほかに切り替え可能なサーバーはありません。'
            : '切り替え可能なサーバーがありません。'}
      </p>
    );
  }

  return (
    <div className="space-y-1" role="list" aria-label="切り替え可能なサーバー">
      {candidates.map((guild) => (
        <div key={guild.id} role="listitem">
          <button
            type="button"
            onClick={() => onSelect(guild)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 overflow-hidden rounded-lg" aria-hidden="true">
              <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={30} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block truncate font-medium">{guild.name}</span>
                {defaultGuildId === guild.id ? (
                  <Star
                    className="h-3 w-3 shrink-0 fill-current text-amber-400"
                    aria-label="デフォルト"
                    role="img"
                  />
                ) : null}
              </span>
              <span className="block truncate text-[10px] text-muted">{guild.id}</span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function QuickNavLink({
  item,
  guildId,
  routeContext,
  compact = false,
}: {
  item: QuickNavItem;
  guildId: string;
  routeContext: ReturnType<typeof getGuildConsoleContext>;
  compact?: boolean;
}) {
  const active = routeContext?.guildId === guildId && routeContext.section === item.section;
  const Icon = item.icon;
  const href = getGuildConsoleHref(guildId, item.section);

  if (compact) {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
          active
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:bg-background hover:text-foreground'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted hover:bg-background hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {item.label}
    </Link>
  );
}
