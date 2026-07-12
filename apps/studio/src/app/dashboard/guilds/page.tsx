import Link from 'next/link';
import { ChevronRight, ServerOff } from 'lucide-react';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuilds } from '@/lib/guilds';
import { GuildAvatar } from '@/components/guild-avatar';
import { ReconnectNotice } from '@/components/reconnect-notice';

export const dynamic = 'force-dynamic';

export default async function GuildsPage() {
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div>
        <PageHeader />
        <div className="mt-8">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  const guilds = await getManageableGuilds(accessToken);

  return (
    <div>
      <PageHeader count={guilds.length} />

      {guilds.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <ServerOff className="h-8 w-8 text-muted" />
          <p className="mt-4 font-medium">管理できるサーバーがありません</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            「管理者」または「サーバー管理」権限を持つ Discord サーバーがここに表示されます。
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {guilds.map((guild) => (
            <li key={guild.id}>
              <Link
                href={`/dashboard/guilds/${guild.id}`}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/40"
              >
                <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{guild.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {guild.owner ? <Badge>オーナー</Badge> : null}
                    {guild.hasAdministrator ? <Badge>管理者</Badge> : null}
                    {guild.hasManageGuild && !guild.hasAdministrator ? (
                      <Badge>サーバー管理</Badge>
                    ) : null}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PageHeader({ count }: { count?: number }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">サーバー</h1>
      <p className="mt-2 text-sm text-muted">
        {count === undefined
          ? 'あなたが管理できる Discord サーバーの一覧です。'
          : `あなたが管理できる Discord サーバー ${count} 件`}
      </p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
      {children}
    </span>
  );
}
