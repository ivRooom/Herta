'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Cake,
  CalendarDays,
  ChevronDown,
  History,
  LayoutDashboard,
  ListChecks,
  Medal,
  MessageSquare,
  Plug,
  Puzzle,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useStudioServerContext } from '@/components/studio-server-context';
import {
  buildStudioCurrentServerToolGroups,
  type StudioCurrentServerToolGroup,
} from '@/lib/studio-current-server-tools';
import { buildSelectedServerNavigationItems } from '@/lib/studio-selected-server-navigation';
import {
  STUDIO_NAV_ITEMS,
  type StudioCommandItem,
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
  rules: ListChecks,
  achievement: Award,
  birthday: Cake,
  daily: CalendarDays,
  lfg: Users,
  moderation: ShieldCheck,
  team: Users,
  message: MessageSquare,
  xp: Star,
  account: UserRound,
};

const WORKSPACE_EXCLUDED_IDS = new Set(['plugins', 'leaderboard', 'account']);
const ALL_SERVER_IDS = new Set(['plugins', 'leaderboard']);

export function DashboardNav({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const pathname = usePathname();
  const { selectedGuild } = useStudioServerContext();
  const selectedServerItems = buildSelectedServerNavigationItems(selectedGuild?.id ?? null);
  const currentServerToolGroups = buildStudioCurrentServerToolGroups(
    selectedGuild?.id ?? null,
    selectedGuild?.name ?? null,
  );
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
          {currentServerToolGroups.map((group) => (
            <CollapsibleNavigationGroup key={group.id} group={group} pathname={pathname} />
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

function CollapsibleNavigationGroup({
  group,
  pathname,
}: {
  group: StudioCurrentServerToolGroup;
  pathname: string;
}) {
  const containsActiveItem = group.items.some((item) => isActive(pathname, item.href, item.exact));
  const [open, setOpen] = useState(containsActiveItem);
  const contentId = `current-server-${group.id}-tools`;

  useEffect(() => {
    if (containsActiveItem) setOpen(true);
  }, [containsActiveItem]);

  return (
    <div className="pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          containsActiveItem
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:bg-surface hover:text-foreground'
        }`}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span className="flex-1">{group.label}</span>
        <span className="rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {group.items.length}
        </span>
      </button>
      {open ? (
        <div id={contentId} className="ml-3 mt-1 space-y-1 border-l border-border pl-2">
          {group.items.map((item) => (
            <NavigationLink key={item.id} item={item} pathname={pathname} nested />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavigationLink({
  item,
  pathname,
  compact = false,
  nested = false,
}: {
  item:
    | StudioNavigationItem
    | StudioCommandItem
    | ReturnType<typeof buildSelectedServerNavigationItems>[number];
  pathname: string;
  compact?: boolean;
  nested?: boolean;
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
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors ${
        nested ? 'text-xs' : 'text-sm'
      } ${
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
