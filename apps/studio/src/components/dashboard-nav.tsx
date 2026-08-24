'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Award,
  BarChart3,
  Cake,
  History,
  LayoutDashboard,
  ListChecks,
  Medal,
  MessageSquare,
  Plug,
  ServerCog,
  Star,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useStudioNavigationContext } from '@/components/studio-navigation-context';
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
  history: History,
  rules: ListChecks,
  achievement: Award,
  birthday: Cake,
  daily: Activity,
  lfg: Users,
  moderation: ListChecks,
  team: Users,
  message: MessageSquare,
  xp: Star,
  account: UserRound,
};

const DASHBOARD_NAV_ITEM = STUDIO_NAV_ITEMS.find((item) => item.id === 'dashboard');
const OPERATIONS_NAV_ITEM = STUDIO_NAV_ITEMS.find((item) => item.id === 'operations');

const PLUGIN_OPERATIONS_NAV_ITEM: StudioNavigationItem = {
  id: 'plugin-operations',
  href: '/dashboard/plugins/operations',
  label: 'Plugin Operations',
  description: 'Plugin Runtime・Attention・反映状態を確認する',
  keywords: ['plugin', 'operations', 'runtime', 'attention', 'プラグイン', '運用'],
  icon: 'plugin',
};

const SETTINGS_NAV_ITEM: StudioNavigationItem = {
  id: 'settings',
  href: '/dashboard/settings',
  label: 'Settings',
  description: 'Studioとサーバー別ナビゲーションを設定する',
  keywords: ['settings', 'navigation', 'tabs', '設定', 'ナビゲーション', 'タブ'],
  icon: 'account',
};

export function DashboardNav({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const pathname = usePathname();
  const { selectedGuild } = useStudioServerContext();
  const { visiblePluginTabIds } = useStudioNavigationContext();
  const selectedServerItems = buildSelectedServerNavigationItems(
    selectedGuild?.id ?? null,
    visiblePluginTabIds,
  );
  const studioItems = DASHBOARD_NAV_ITEM ? [DASHBOARD_NAV_ITEM] : [];
  const controlCenterItems = buildControlCenterItems(selectedGuild?.id ?? null);

  if (variant === 'mobile') {
    const items = [...studioItems, ...selectedServerItems, ...controlCenterItems];
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
      <NavigationGroup label="Studio">
        {studioItems.map((item) => (
          <NavigationLink key={item.id} item={item} pathname={pathname} />
        ))}
      </NavigationGroup>

      {selectedGuild ? (
        <NavigationGroup label="Current Server" detail={selectedGuild.name}>
          {selectedServerItems.map((item) => (
            <NavigationLink key={item.id} item={item} pathname={pathname} />
          ))}
        </NavigationGroup>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted">
          Server
          Switcherでサーバーを選択すると、Overview・Plugins・Commands・Community・Moderation・Analyticsが表示されます。
        </div>
      )}

      <NavigationGroup label="Control Center">
        {controlCenterItems.map((item) => (
          <NavigationLink key={item.id} item={item} pathname={pathname} />
        ))}
      </NavigationGroup>
    </nav>
  );
}

function buildControlCenterItems(guildId: string | null): StudioNavigationItem[] {
  const items: StudioNavigationItem[] = [];
  if (OPERATIONS_NAV_ITEM) items.push(OPERATIONS_NAV_ITEM);
  items.push(PLUGIN_OPERATIONS_NAV_ITEM);

  if (guildId) {
    items.push(
      {
        id: 'selected-server-audit-logs',
        href: `/dashboard/guilds/${guildId}/audit-logs`,
        label: 'Audit Log',
        description: '選択中サーバーの操作履歴を確認する',
        keywords: ['audit', 'history', '監査', '履歴'],
        icon: 'history',
      },
      {
        id: 'selected-server-access',
        href: `/dashboard/guilds/${guildId}/access`,
        label: 'Access Control',
        description: '選択中サーバーのUsers・Groups・Roles・Policiesを管理する',
        keywords: ['iam', 'access', 'role', 'policy', '権限', 'ロール'],
        icon: 'account',
      },
    );
  }

  items.push(SETTINGS_NAV_ITEM);
  return items;
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
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}

function isActive(pathname: string, href: string, exact = false): boolean {
  const hrefPathname = href.split('?', 1)[0] ?? href;
  if (exact) return pathname === hrefPathname;
  return pathname === hrefPathname || pathname.startsWith(`${hrefPathname}/`);
}
