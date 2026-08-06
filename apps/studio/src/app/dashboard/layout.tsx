import Link from 'next/link';
import { Activity, BarChart3 } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const { name, image } = session.user;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background">
                H
              </span>
              <span className="hidden tracking-tight sm:inline">Herta Studio</span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="ダッシュボード">
              <Link
                href="/dashboard"
                className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-foreground"
              >
                ホーム
              </Link>
              <Link
                href="/dashboard/guilds"
                className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-foreground"
              >
                サーバー
              </Link>
              <Link
                href="/dashboard/operations"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-foreground"
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                稼働状況
              </Link>
              <Link
                href="/dashboard/analytics"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-foreground"
              >
                <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                利用状況
              </Link>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Link
              href="/dashboard/analytics"
              className="rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-foreground sm:hidden"
              aria-label="Bot利用状況"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard/operations"
              className="rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-foreground sm:hidden"
              aria-label="Bot稼働状況"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="hidden text-sm text-muted sm:inline">{name}</span>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={name ?? 'user'}
                width={28}
                height={28}
                className="hidden h-7 w-7 rounded-full border border-border object-cover min-[360px]:block"
              />
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
