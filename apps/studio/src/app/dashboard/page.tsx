import Link from 'next/link';
import { Activity, ArrowRight, BarChart3, ServerCog, ShieldCheck } from 'lucide-react';
import { auth } from '@/auth';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuilds } from '@/lib/guilds';
import { ReconnectNotice } from '@/components/reconnect-notice';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  let guildCount: number | null = null;
  if (accessToken) {
    try {
      const guilds = await getManageableGuilds(accessToken);
      guildCount = guilds.length;
    } catch {
      guildCount = null;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        こんにちは、{session?.user?.name} さん
      </h1>
      <p className="mt-2 text-sm text-muted">
        Discordサーバーの設定とHerta Botの運用状態を管理できます。
      </p>

      {!accessToken ? (
        <div className="mt-8">
          <ReconnectNotice />
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {accessToken ? (
          <Link
            href="/dashboard/guilds"
            className="group rounded-2xl border border-border bg-surface p-6 shadow-card transition-colors hover:border-primary/40"
          >
            <div className="flex items-center justify-between">
              <ServerCog className="h-6 w-6 text-primary" aria-hidden="true" />
              <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
            </div>
            <h2 className="mt-4 font-medium">管理可能なサーバー</h2>
            <p className="mt-1 text-sm text-muted">
              {guildCount === null ? '一覧を表示' : `${guildCount} 件のサーバーを管理できます`}
            </p>
          </Link>
        ) : null}

        <Link
          href="/dashboard/operations"
          className="group rounded-2xl border border-border bg-surface p-6 shadow-card transition-colors hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
          </div>
          <h2 className="mt-4 font-medium">Bot稼働状況</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Discord、DB、Redis、Workerの状態をまとめて確認します。
          </p>
        </Link>

        <Link
          href="/dashboard/analytics"
          className="group rounded-2xl border border-border bg-surface p-6 shadow-card transition-colors hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <BarChart3 className="h-6 w-6 text-primary" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
          </div>
          <h2 className="mt-4 font-medium">Bot利用状況</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            コマンド実行数、成功率、利用傾向、直近の失敗を確認します。
          </p>
        </Link>

        {accessToken ? (
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="mt-4 font-medium">権限について</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              「管理者」または「サーバー管理」権限を持つサーバーのみが表示されます。
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
