import Link from 'next/link';
import { AlertTriangle, Bot, ChevronRight, ExternalLink, ServerOff } from 'lucide-react';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuilds } from '@/lib/guilds';
import { DiscordApiError } from '@/lib/discord';
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

  let guilds: Awaited<ReturnType<typeof getManageableGuilds>>;
  try {
    guilds = await getManageableGuilds(accessToken);
  } catch (error) {
    if (!(error instanceof DiscordApiError)) throw error;
    if (error.status === 401) {
      return (
        <div>
          <PageHeader />
          <div className="mt-8">
            <ReconnectNotice />
          </div>
        </div>
      );
    }
    return (
      <div>
        <PageHeader />
        <DiscordApiNotice error={error} />
      </div>
    );
  }

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

function DiscordApiNotice({ error }: { error: DiscordApiError }) {
  const retryAfterSeconds =
    error.retryAfterMs === null ? null : Math.max(1, Math.ceil(error.retryAfterMs / 1_000));
  const title =
    error.status === 429
      ? 'Discord API のレート制限中です'
      : error.status >= 500
        ? 'Discord API が一時的に利用できません'
        : 'Discord API へ接続できません';
  const description =
    error.status === 429
      ? retryAfterSeconds === null
        ? '少し待ってからサーバー一覧を再取得してください。'
        : `約 ${retryAfterSeconds} 秒待ってからサーバー一覧を再取得してください。`
      : error.status === 403
        ? 'Discord からサーバー一覧を取得する権限がありません。必要に応じて再ログインしてください。'
        : 'しばらく待ってからサーバー一覧を再取得してください。';

  return (
    <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <h2 className="font-medium">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          <a
            href="/dashboard/guilds"
            className="mt-4 inline-flex rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
          >
            サーバー一覧を再試行
          </a>
        </div>
      </div>
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
              Guild InstallとしてBot本体とSlash Commandを追加します。すでに追加済みの場合は、
              権限の確認・更新にも利用できます。
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
