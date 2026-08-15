'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  CircleAlert,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { signInWithDiscord, signOutAction } from '@/lib/actions';
import { STUDIO_ACCOUNT_NAV_ITEM } from '@/lib/studio-navigation';

interface AccountMenuProps {
  name?: string | null;
  image?: string | null;
  email?: string | null;
  reconnectRequired?: boolean;
  variant?: 'desktop' | 'mobile';
}

export function AccountMenu({
  name,
  image,
  email,
  reconnectRequired = false,
  variant = 'desktop',
}: AccountMenuProps) {
  const pathname = usePathname();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const displayName = name?.trim() || 'Herta User';
  const initial = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key === 'Tab') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    const frame = requestAnimationFrame(() => getMenuItems(menuRef.current)[0]?.focus());

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const items = getMenuItems(menuRef.current);
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Home') {
      items[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      items.at(-1)?.focus();
      return;
    }

    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="アカウントメニューを開く"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={
          variant === 'desktop'
            ? 'flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        <AccountAvatar image={image} name={displayName} initial={initial} size={variant} />
        {variant === 'desktop' ? (
          <>
            <span className="max-w-36 truncate text-xs font-medium">{displayName}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </>
        ) : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="アカウント"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface p-2 shadow-card"
        >
          <div className="flex min-w-0 items-center gap-3 px-2 py-2.5">
            <AccountAvatar image={image} name={displayName} initial={initial} size="summary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted">{email || 'Discord OAuth'}</p>
            </div>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                reconnectRequired
                  ? 'bg-amber-500/10 text-amber-500'
                  : 'bg-emerald-500/10 text-emerald-500'
              }`}
              title={reconnectRequired ? 'Discord再接続が必要です' : 'Discord連携は有効です'}
            >
              {reconnectRequired ? (
                <CircleAlert className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
          </div>

          <div className="my-1 h-px bg-border" aria-hidden="true" />

          <Link
            href={STUDIO_ACCOUNT_NAV_ITEM.href}
            role="menuitem"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            aria-current={pathname === STUDIO_ACCOUNT_NAV_ITEM.href ? 'page' : undefined}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-background focus:bg-background focus:outline-none"
          >
            <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
            <span>
              <span className="block font-medium">アカウントセンター</span>
              <span className="mt-0.5 block text-[11px] text-muted">Discord連携とセッションを確認</span>
            </span>
          </Link>

          {reconnectRequired ? (
            <form action={signInWithDiscord}>
              <input type="hidden" name="callbackUrl" value={STUDIO_ACCOUNT_NAV_ITEM.href} />
              <button
                type="submit"
                role="menuitem"
                tabIndex={-1}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-amber-500 transition-colors hover:bg-amber-500/10 focus:bg-amber-500/10 focus:outline-none"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span>
                  <span className="block font-medium">Discordを再接続</span>
                  <span className="mt-0.5 block text-[11px] text-amber-500/80">
                    管理可能なサーバー一覧を再取得
                  </span>
                </span>
              </button>
            </form>
          ) : null}

          <div className="my-1 h-px bg-border" aria-hidden="true" />

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              tabIndex={-1}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition-colors hover:bg-background hover:text-foreground focus:bg-background focus:text-foreground focus:outline-none"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              ログアウト
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function AccountAvatar({
  image,
  name,
  initial,
  size,
}: {
  image?: string | null;
  name: string;
  initial: string;
  size: 'desktop' | 'mobile' | 'summary';
}) {
  const className =
    size === 'summary'
      ? 'h-10 w-10 rounded-xl'
      : size === 'desktop'
        ? 'h-7 w-7 rounded-lg'
        : 'h-7 w-7 rounded-lg';

  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={size === 'summary' ? name : ''}
        width={size === 'summary' ? 40 : 28}
        height={size === 'summary' ? 40 : 28}
        className={`${className} shrink-0 border border-border object-cover`}
      />
    );
  }

  return (
    <span
      className={`flex ${className} shrink-0 items-center justify-center bg-primary/10 text-xs font-bold text-primary`}
      aria-hidden={size !== 'summary'}
    >
      {initial || 'H'}
    </span>
  );
}

function getMenuItems(menu: HTMLDivElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}
