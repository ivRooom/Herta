import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { GuildContextNav } from '@/components/guild-context-nav';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { name, image } = session.user;

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface/80 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/dashboard" className="flex items-center gap-3 px-2">
          <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-violet-400 text-base font-black text-white shadow-lg shadow-primary/20">
            H
            <span className="absolute inset-x-2 bottom-1 h-px bg-white/40" />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">Herta Studio</span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
              <Sparkles className="h-3 w-3 text-primary" /> Discord Control Center
            </span>
          </span>
        </Link>

        <div className="mt-8 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Workspace
        </div>
        <div className="mt-2 flex-1">
          <DashboardNav />
        </div>

        <div className="rounded-2xl border border-border bg-background/70 p-3">
          <div className="flex min-w-0 items-center gap-3">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={name ?? 'user'}
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 rounded-xl border border-border object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {(name ?? 'H').slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name ?? 'Herta User'}</p>
              <p className="text-[11px] text-muted">Administrator</p>
            </div>
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 hidden border-b border-border bg-background/85 backdrop-blur-xl lg:block">
          <div className="flex h-16 items-center justify-end gap-3 px-6 xl:px-8">
            <GuildContextNav variant="desktop" />
            <div
              className="flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5"
              title={name ?? 'Herta User'}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 rounded-lg border border-border object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  {(name ?? 'H').slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="max-w-36 truncate text-xs font-medium">{name ?? 'Herta User'}</span>
            </div>
          </div>
        </header>

        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-xl lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-2 font-semibold">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-400 text-sm font-black text-white">
                H
              </span>
              <span className="truncate tracking-tight">Herta Studio</span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <GuildContextNav variant="mobile" />
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={name ?? 'user'}
                  width={30}
                  height={30}
                  className="h-8 w-8 rounded-xl border border-border object-cover"
                />
              ) : null}
              <SignOutButton />
            </div>
          </div>
          <div className="border-t border-border/70">
            <DashboardNav variant="mobile" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 xl:px-8 xl:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
