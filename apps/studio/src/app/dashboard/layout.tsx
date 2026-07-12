import Link from 'next/link';
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
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background">
                H
              </span>
              <span className="tracking-tight">Herta Studio</span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm sm:flex">
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
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{name}</span>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={name ?? 'user'}
                width={28}
                height={28}
                className="h-7 w-7 rounded-full border border-border object-cover"
              />
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
