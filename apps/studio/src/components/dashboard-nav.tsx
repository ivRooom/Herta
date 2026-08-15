'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Medal,
  Puzzle,
  ServerCog,
  Sparkles,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { STUDIO_NAV_ITEMS, type StudioNavigationIcon } from '@/lib/studio-navigation';

const NAV_ICONS: Partial<Record<StudioNavigationIcon, LucideIcon>> = {
  dashboard: LayoutDashboard,
  server: ServerCog,
  activity: Activity,
  analytics: BarChart3,
  community: Trophy,
  leaderboard: Medal,
  'custom-plugin': Puzzle,
  account: UserRound,
};

export function DashboardNav({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const pathname = usePathname();

  if (variant === 'mobile') {
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Studioナビゲーション">
        {STUDIO_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = NAV_ICONS[item.icon];
          if (!Icon) return null;

          return (
            <Link
              key={item.href}
              href={item.href}
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
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-1" aria-label="Studioナビゲーション">
      {STUDIO_NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const Icon = NAV_ICONS[item.icon];
        if (!Icon) return null;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted hover:bg-surface hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {item.id === 'custom-plugins' ? (
              <Sparkles className="h-3.5 w-3.5 text-primary/70" aria-label="新機能" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
