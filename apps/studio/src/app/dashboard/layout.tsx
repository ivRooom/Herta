import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { AccountMenu } from '@/components/account-menu';
import {
  ConsoleCommandPaletteController,
  ConsoleCommandPaletteTrigger,
} from '@/components/console-command-palette';
import { DashboardNav } from '@/components/dashboard-nav';
import {
  GuildContextNav,
  type GuildSwitcherItem,
  type GuildSwitcherState,
} from '@/components/guild-context-nav';
import { StudioServerContextProvider } from '@/components/studio-server-context';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { STUDIO_ACCOUNT_NAV_ITEM } from '@/lib/studio-navigation';
import {
  getDefaultStudioGuildId,
  setDefaultStudioGuildId,
} from '@/lib/studio-user-preferences';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { name, image, email } = session.user;
  const accessToken = await getDiscordAccessToken();
  let guilds: GuildSwitcherItem[] = [];
  let guildsState: GuildSwitcherState = accessToken ? 'ready' : 'reconnect-required';
  let initialDefaultGuildId: string | null = null;

  try {
    initialDefaultGuildId = await getDefaultStudioGuildId(session.user.id);
  } catch (error) {
    console.error('Studio default server could not be loaded', {
      userId: session.user.id,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  if (accessToken) {
    try {
      guilds = (await getManageableGuilds(accessToken)).map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
      }));
    } catch (error) {
      guildsState = 'unavailable';
      console.error(
        'Guild switcher could not load manageable guilds',
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
  }

  if (
    guildsState === 'ready' &&
    initialDefaultGuildId &&
    !guilds.some((guild) => guild.id === initialDefaultGuildId)
  ) {
    try {
      await setDefaultStudioGuildId(session.user.id, null);
      initialDefaultGuildId = null;
    } catch (error) {
      console.error('Invalid Studio default server could not be cleared', {
        userId: session.user.id,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  const reconnectRequired = guildsState === 'reconnect-required';
  const displayName = name?.trim() || 'Herta User';

  return (
    <StudioServerContextProvider guilds={guilds} initialDefaultGuildId={initialDefaultGuildId}>
      <div className="min-h-screen bg-background">
        <ConsoleCommandPaletteController />

        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface/80 px-4 py-5 backdrop-blur-xl lg:flex">
          <Link href="/dashboard" className="flex items-center gap-3 px-2">
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-violet-400 text-base font-black text-white shadow-lg shadow-primary/20">
              H
              <span className="absolute inset-x-2 bottom-1 h-px bg-white/40" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">Herta Studio</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" /> Discord Control Center
              </span>
            </span>
          </Link>

          <div className="mt-8 min-h-0 flex-1 overflow-y-auto pr-1">
            <DashboardNav />
          </div>

          <Link
            href={STUDIO_ACCOUNT_NAV_ITEM.href}
            className="group mt-4 flex items-center gap-3 rounded-2xl border border-border bg-background/70 p-3 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 rounded-xl border border-border object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {displayName.slice(0, 1).toUpperCase() || 'H'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="text-[11px] text-muted">
                {reconnectRequired ? 'Discord再接続が必要' : 'Account Center'}
              </p>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </aside>

        <div className="min-h-screen lg:pl-64">
          <header className="sticky top-0 z-20 hidden border-b border-border bg-background/85 backdrop-blur-xl lg:block">
            <div className="flex h-16 items-center justify-end gap-3 px-6 xl:px-8">
              <ConsoleCommandPaletteTrigger variant="desktop" />
              <GuildContextNav variant="desktop" guildsState={guildsState} />
              <AccountMenu
                name={name}
                image={image}
                email={email}
                reconnectRequired={reconnectRequired}
                variant="desktop"
              />
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
                <ConsoleCommandPaletteTrigger variant="mobile" />
                <GuildContextNav variant="mobile" guildsState={guildsState} />
                <AccountMenu
                  name={name}
                  image={image}
                  email={email}
                  reconnectRequired={reconnectRequired}
                  variant="mobile"
                />
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
    </StudioServerContextProvider>
  );
}
