'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  History,
  LayoutDashboard,
  Medal,
  Plug,
  Puzzle,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useStudioServerContext } from '@/components/studio-server-context';
import { buildSelectedServerNavigationItems } from '@/lib/studio-selected-server-navigation';
import {
  STUDIO_NAV_ITEMS,
  type StudioNavigationIcon,
  type StudioNavigationItem,
} from '@/lib/studio-navigation';

const NAV_ICONS: Partial<Record<StudioNavigationIcon, LucideIcon>> = {
  dashboard: LayoutDashboard,
  server: ServerCog,
  activity: Activity,
  analytics: BarChart3,
  community: Trophy,
  leaderboard: Medal,
  plugin: Plug,
  'custom-plugin': Puzzle,
  history: History,
  moderation: ShieldCheck,
  account: UserRound,
};

const WORKSPACE_EXCLUDED_IDS = new Set(['plugins', 'leaderboard', 'account']);
const ALL_SERVER_IDS = new Set(['plugins', 'leaderboard']);

export function DashboardNav({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const pathname = usePathname();
  const { selectedGuild } = useStudioServerContext();
  const selectedServerItems = buildSelectedServerNavigationItems(selectedGuild?.id ?? null);
  const workspaceItems = STUDIO_NAV_ITEMS.filter((item) => !WORKSPACE_EXCLUDED_IDS.has(item.id));
  const allServerItems = STUDIO_NAV_ITEMS.filter((item) => ALL_SERVER_IDS.has(item.id));

  if (variant === 'mobile') {
    const items = [...selectedServerItems, ...workspaceItems, ...allServerItems];
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Studioナビゲーション">
        {items.map((item) => (
          <NavigationLink key={item.id} item={item} pathname={pathname} compact />
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-5" aria-label="Studioナビゲーション">
      {selectedGuild ? (
        <NavigationGroup label="Current Server" detail={selectedGuild.name}>
          {selectedServerItems.map((item) => (
            <NavigationLink key={item.id} item={item} pathname={pathname} />
          ))}
        </NavigationGroup>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted">
          Server Switcherでサーバーを選択すると、ここにサーバー別メニューが表示されます。
        </div>
      )}

      <NavigationGroup label="Workspace">
        {workspaceItems.map((item) => (
          <NavigationLink key={item.id} item={item} pathname={pathname} />
        ))}
      </NavigationGroup>

      <NavigationGroup label="All Servers">
        {allServerItems.map((item) => (
          <NavigationLink
            key={item.id}
            item={{
              ...item,
              label: item.id === 'plugins' ? '全サーバーPlugin' : 'Leaderboard Hub',
            }}
            pathname={pathname}
          />
        ))}
      </NavigationGroup>
    </nav>
  );
}

function NavigationGroup({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</p>
        {detail ? <span className="max-w-28 truncate text-[10px] text-muted">{detail}</span> : null}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function NavigationLink({
  item,
  pathname,
  compact = false,
}: {
  item: StudioNavigationItem | ReturnType<typeof buildSelectedServerNavigationItems>[number];
  pathname: string;
  compact?: boolean;
}) {
  const active = isActive(pathname, item.href, item.exact);
  const Icon = NAV_ICONS[item.icon];
  if (!Icon) return null;

  if (compact) {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={item.description}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
          active
            ? 'bg-primary/15 text-primary'
            : 'text-muted hover:bg-surface hover:text-foreground'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.description}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.id === 'custom-plugins' ? (
        <Sparkles className="h-3.5 w-3.5 text-primary/70" aria-label="新機能" />
      ) : null}
    </Link>
  );
}

function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
