import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Plug,
  Puzzle,
  ServerCog,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { GuildAvatar } from '@/components/guild-avatar';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getManageableGuilds } from '@/lib/guilds';
import { getPluginManagementOverview } from '@/lib/plugin-management-overview';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function PluginManagementPage() {
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <ReconnectNotice />
      </div>
    );
  }

  const guildResult = await getManageableGuilds(accessToken)
    .then((guilds) => ({ ok: true as const, guilds }))
    .catch(() => ({ ok: false as const, guilds: [] }));

  if (!guildResult.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5 sm:p-6">
          <h2 className="font-semibold">サーバー情報を取得できませんでした</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Discordとの接続状態を確認してから再読み込みしてください。Plugin設定の変更処理は行われていません。
          </p>
        </section>
      </div>
    );
  }

  const overview = await getPluginManagementOverview(guildResult.guilds.map((guild) => guild.id));
  const configuredGuilds = guildResult.guilds.filter(
    (guild) => (overview.byGuild[guild.id]?.installed ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-7">
      <PageHeader />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Plugin利用状況">
        <SummaryCard
          label="管理可能なサーバー"
          value={guildResult.guilds.length.toLocaleString()}
          detail="Discordの管理権限を確認済み"
        />
        <SummaryCard
          label="公式Plugin"
          value={overview.availablePlugins.toLocaleString()}
          detail="各サーバーで利用可能"
        />
        <SummaryCard
          label="設定済みサーバー"
          value={`${configuredGuilds} / ${guildResult.guilds.length}`}
          detail="Plugin設定レコードあり"
        />
        <SummaryCard
          label="有効Plugin"
          value={overview.enabledInstances.toLocaleString()}
          detail={`${overview.installedInstances.toLocaleString()}件の設定済みPlugin`}
          accent
        />
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Server Plugin Management
            </p>
            <h2 className="mt-2 text-xl font-semibold">サーバーを選んで管理</h2>
            <p className="mt-1 text-sm text-muted">
              Pluginの有効化・無効化、設定、運用画面への移動をサーバー単位で行えます。
            </p>
          </div>
          <Link
            href="/dashboard/guilds"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ServerCog className="h-4 w-4" aria-hidden="true" /> サーバー一覧
          </Link>
        </div>

        {guildResult.guilds.length > 0 ? (
          <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {guildResult.guilds.map((guild) => {
              const summary = overview.byGuild[guild.id] ?? { installed: 0, enabled: 0 };
              return (
                <li
                  key={guild.id}
                  className="rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start gap-3">
                    <GuildAvatar name={guild.name} iconUrl={guild.iconUrl} size={44} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{guild.name}</h3>
                      <p className="mt-1 truncate text-[11px] text-muted">{guild.id}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        summary.enabled > 0
                          ? 'bg-emerald-400/10 text-emerald-400'
                          : 'bg-border/50 text-muted'
                      }`}
                    >
                      {summary.enabled > 0 ? 'Active' : '未有効化'}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <ServerMetric label="有効" value={`${summary.enabled}`} />
                    <ServerMetric
                      label="設定済み"
                      value={`${summary.installed} / ${overview.availablePlugins}`}
                    />
                  </div>

                  <div className="mt-5 flex gap-2">
                    <Link
                      href={`/dashboard/guilds/${guild.id}/plugins`}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      <Settings2 className="h-4 w-4" aria-hidden="true" /> 管理する
                    </Link>
                    <Link
                      href={`/dashboard/guilds/${guild.id}`}
                      aria-label={`${guild.name}のコンソールを開く`}
                      className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3 text-muted transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <ServerCog className="mx-auto h-8 w-8 text-muted" aria-hidden="true" />
            <h3 className="mt-3 font-semibold">管理可能なサーバーがありません</h3>
            <p className="mt-2 text-sm text-muted">
              Discordでサーバー管理権限を持つアカウントを接続すると、ここに表示されます。
            </p>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Link
          href="/dashboard/custom-plugins"
          className="group rounded-2xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/40 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Puzzle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Custom Plugin Hub</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                カスタムPluginの導入基盤、署名、権限宣言、ロールバックのロードマップを確認します。
              </p>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">安全な管理フロー</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                実際のPlugin変更は各サーバーの管理権限を再確認し、既存の設定検証・監査ログ・Runtime通知を通して反映します。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Plugin Control Center
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">プラグイン管理</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            管理可能なDiscordサーバーのPlugin状態を横断して確認し、必要なサーバーの設定画面へすぐ移動できます。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-xs text-muted">
          <Plug className="h-4 w-4 text-primary" aria-hidden="true" />
          Official + Custom Plugin Workspace
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent ? 'text-primary' : ''}`}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function ServerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}
