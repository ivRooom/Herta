import Link from 'next/link';
import { Bot, ChevronRight, ExternalLink, ServerOff } from 'lucide-react';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordGuildInstallUrl } from '@/lib/discord-install';
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
  const installUrl = getDiscordGuildInstallUrl();

  return (
    <div>
      <PageHeader count={guilds.length} />
      <GuildInstallCard installUrl={installUrl} />

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

function GuildInstallCard({ installUrl }: { installUrl: string | null }) {
  return (
    <section className="mt-6 rounded-2xl border border-[#5865F2]/30 bg-[#5865F2]/10 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2] text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-medium">Herta Bot をサーバーへ追加</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              Guild InstallとしてBot本体とSlash Commandを追加します。すでに追加済みの場合は、権限の確認・更新にも利用できます。
            </p>
          </div>
        </div>

        {installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Discord で追加
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <span className="text-sm text-muted">Discord Application ID が未設定です</span>
        )}
      </div>
    </section>
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
