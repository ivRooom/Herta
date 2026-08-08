import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  MessageCircleReply,
  Puzzle,
  Quote,
  ServerCog,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { auth } from '@/auth';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getBotHealth } from '@/lib/bot-health';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'Moderation',
    description: '自動検知、Case、削除、Timeout、BAN、緊急Alertを一元管理',
    icon: ShieldCheck,
  },
  {
    title: 'Auto Response',
    description: 'ルールベースの自動応答をGuildごとに構成',
    icon: MessageCircleReply,
  },
  {
    title: 'LFG',
    description: '募集作成、参加・辞退、期限、Discordカードを管理',
    icon: UsersRound,
  },
  {
    title: 'Team Split',
    description: 'random / balanced方式でチーム分けと結果表示',
    icon: UsersRound,
  },
  {
    title: 'Quote',
    description: 'サーバーごとの名言を登録・検索・管理',
    icon: Quote,
  },
  {
    title: 'Daily Content',
    description: '定時コンテンツ配信、履歴、失敗再実行を管理',
    icon: CalendarDays,
  },
] as const;

export default async function DashboardPage() {
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  const [guildResult, health] = await Promise.all([
    accessToken
      ? getManageableGuilds(accessToken)
          .then((guilds) => ({ ok: true as const, guilds }))
          .catch(() => ({ ok: false as const, guilds: [] }))
      : Promise.resolve({ ok: false as const, guilds: [] }),
    getBotHealth(),
  ]);

  const healthStatus = health.available ? health.health.status : 'unknown';
  const gatewayStatus = health.available ? health.health.checks.discord.gateway_status : 'unknown';
  const version = health.available ? health.health.version : '---';

  return (
    <div className="space-y-7">
      {!accessToken ? <ReconnectNotice /> : null}

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Herta Studio Next
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              おかえりなさい、{session?.user?.name ?? 'Herta User'} さん
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">
              Discordサーバーの運用、Moderation、Automation、ゲーム機能を一つのコントロールセンターから管理します。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/dashboard/guilds"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20"
              >
                サーバーを管理 <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard/custom-plugins"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/70 px-4 py-2.5 text-sm font-semibold hover:border-primary/40"
              >
                <Puzzle className="h-4 w-4 text-primary" /> Custom Plugin Hub
              </Link>
            </div>
          </div>

          <div className="relative min-h-44 overflow-hidden rounded-2xl border border-primary/15 bg-background/70 p-5">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/15 blur-2xl" />
            <div className="relative flex h-full flex-col justify-between gap-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                    Bot Status
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{statusLabel(healthStatus)}</p>
                </div>
                <span
                  className={`mt-1 h-3 w-3 rounded-full ${healthStatus === 'operational' ? 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)]' : healthStatus === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <MiniMetric label="Gateway" value={gatewayLabel(gatewayStatus)} />
                <MiniMetric label="Version" value={`v${version}`} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ServerCog}
          label="管理可能なサーバー"
          value={accessToken && guildResult.ok ? `${guildResult.guilds.length}` : '---'}
          description="Discord OAuthで管理権限を確認"
        />
        <MetricCard
          icon={Bot}
          label="Herta Bot"
          value={statusLabel(healthStatus)}
          description={
            health.available ? `${health.health.guild_count} Guildで認識` : '状態を取得できません'
          }
        />
        <MetricCard
          icon={Activity}
          label="Discord Gateway"
          value={gatewayLabel(gatewayStatus)}
          description={
            health.available && health.health.checks.discord.ready
              ? 'Gateway Ready'
              : '接続状態を確認してください'
          }
        />
        <MetricCard
          icon={CheckCircle2}
          label="Runtime"
          value={version === '---' ? '---' : `v${version}`}
          description="Production Bot runtime"
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                Quick Access
              </p>
              <h2 className="mt-2 text-lg font-semibold">運用ショートカット</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <QuickLink
              href="/dashboard/guilds"
              icon={ServerCog}
              title="サーバー管理"
              description="Plugin・Moderation設定"
            />
            <QuickLink
              href="/dashboard/operations"
              icon={Activity}
              title="稼働状況"
              description="Bot・DB・Redis・Worker"
            />
            <QuickLink
              href="/dashboard/analytics"
              icon={BarChart3}
              title="アナリティクス"
              description="利用状況と失敗傾向"
            />
            <QuickLink
              href="/dashboard/custom-plugins"
              icon={Puzzle}
              title="Custom Plugin"
              description="SDK・導入基盤ロードマップ"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            System Overview
          </p>
          <h2 className="mt-2 text-lg font-semibold">現在の運用状態</h2>
          <div className="mt-5 space-y-3">
            <StatusRow
              label="Discord"
              ok={health.available && health.health.checks.discord.status === 'ok'}
            />
            <StatusRow
              label="Database"
              ok={health.available && health.health.checks.database.status === 'ok'}
            />
            <StatusRow
              label="Redis"
              ok={health.available && health.health.checks.redis.status === 'ok'}
            />
            <StatusRow
              label="Worker"
              ok={health.available && health.health.checks.worker.status === 'ok'}
            />
          </div>
          <Link
            href="/dashboard/operations"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            詳細を確認 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Capabilities
            </p>
            <h2 className="mt-2 text-xl font-semibold">Hertaで使える機能</h2>
            <p className="mt-1 text-sm text-muted">
              公式Pluginを組み合わせてGuildごとに必要な機能だけ有効化できます。
            </p>
          </div>
          <Link
            href="/dashboard/guilds"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Pluginを設定する
          </Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="rounded-2xl border border-border bg-surface p-5 shadow-card"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: typeof ServerCog;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Live</span>
      </div>
      <p className="mt-4 text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof ServerCog;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-background/60 p-4 transition-colors hover:border-primary/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{description}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3 text-sm">
      <span>{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-400' : 'text-amber-400'}`}
      >
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        {ok ? 'Operational' : 'Check'}
      </span>
    </div>
  );
}

function statusLabel(status: string): string {
  return (
    {
      operational: 'Operational',
      degraded: 'Degraded',
      maintenance: 'Maintenance',
      outage: 'Outage',
      unknown: 'Unknown',
    }[status] ?? 'Unknown'
  );
}

function gatewayLabel(status: string): string {
  return (
    {
      ready: 'Ready',
      connecting: 'Connecting',
      reconnecting: 'Reconnecting',
      disconnected: 'Disconnected',
      unknown: 'Unknown',
    }[status] ?? 'Unknown'
  );
}
