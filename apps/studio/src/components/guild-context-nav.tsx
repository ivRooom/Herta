'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  History,
  LayoutDashboard,
  Plug,
  ServerCog,
  type LucideIcon,
} from 'lucide-react';
import {
  getGuildConsoleContext,
  getGuildConsoleHref,
  type GuildConsoleSection,
} from '@/lib/guild-context-nav';

type Variant = 'desktop' | 'mobile';

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

export function GuildContextNav({ variant }: { variant: Variant }) {
  const pathname = usePathname();
  const context = getGuildConsoleContext(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!mobileMenuRef.current?.contains(event.target as Node)) setMobileOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen]);

  if (variant === 'mobile') {
    if (!context) {
      return (
        <Link
          href="/dashboard/guilds"
          aria-label="サーバー管理を開く"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:text-foreground"
        >
          <ServerCog className="h-4 w-4" aria-hidden="true" />
        </Link>
      );
    }

    return (
      <div ref={mobileMenuRef} className="relative">
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="guild-context-mobile-menu"
          aria-label="サーバー管理メニュー"
          onClick={() => setMobileOpen((current) => !current)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors ${
            mobileOpen
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-surface text-muted hover:text-foreground'
          }`}
        >
          <ServerCog className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">サーバー管理</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {mobileOpen ? (
          <div
            id="guild-context-mobile-menu"
            className="absolute right-0 top-11 z-50 w-56 rounded-2xl border border-border bg-surface p-2 shadow-xl"
          >
            <p className="px-2.5 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Current Server
            </p>
            <nav className="space-y-1" aria-label="現在のサーバー管理">
              {QUICK_NAV_ITEMS.map((item) => (
                <QuickNavLink key={item.section} item={item} context={context} mobile />
              ))}
            </nav>
            <div className="mt-2 border-t border-border pt-2">
              <Link
                href="/dashboard/guilds"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <ServerCog className="h-4 w-4" aria-hidden="true" />
                サーバーを切り替える
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        href="/dashboard/guilds"
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-muted transition-colors hover:text-foreground"
      >
        <ServerCog className="h-4 w-4" aria-hidden="true" />
        {context ? 'サーバー切替' : 'サーバー'}
      </Link>

      {context ? (
        <nav
          className="flex min-w-0 items-center gap-1 rounded-xl border border-border bg-surface p-1"
          aria-label="現在のサーバー管理"
        >
          {QUICK_NAV_ITEMS.map((item) => (
            <QuickNavLink key={item.section} item={item} context={context} />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function QuickNavLink({
  item,
  context,
  mobile = false,
}: {
  item: QuickNavItem;
  context: NonNullable<ReturnType<typeof getGuildConsoleContext>>;
  mobile?: boolean;
}) {
  const active = context.section === item.section;
  const Icon = item.icon;
  const href = getGuildConsoleHref(context.guildId, item.section);

  if (mobile) {
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-background hover:text-foreground'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
        active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-background hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {item.label}
    </Link>
  );
}
