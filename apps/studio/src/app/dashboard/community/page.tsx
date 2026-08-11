import Link from 'next/link';
import {
  BarChart3,
  MessageSquare,
  Mic2,
  Pickaxe,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const metrics = ['messages', 'voice_seconds', 'reactions_given', 'reactions_received'] as const;
type Metric = (typeof metrics)[number];

const metricLabels: Record<Metric, string> = {
  messages: '発言数',
  voice_seconds: 'VC滞在時間',
  reactions_given: 'リアクション',
  reactions_received: 'もらったリアクション',
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function formatSeconds(value: number): string {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}時間 ${minutes}分`;
}

function formatMetric(metric: string, value: number): string {
  return metric.endsWith('_seconds') ? formatSeconds(value) : value.toLocaleString('ja-JP');
}

function jstPeriodStart(days: number): Date {
  const now = new Date();
  const key = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = new Date(`${key}T00:00:00.000Z`);
  return new Date(today.getTime() - (days - 1) * 86_400_000);
}

interface SummaryCard {
  label: string;
  value: number;
  icon: LucideIcon;
  duration?: boolean;
}

export default async function CommunityDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const accessToken = await getDiscordAccessToken();
  if (!accessToken) redirect('/login');

  const guilds = await getManageableGuilds(accessToken);
  const params = (await searchParams) ?? {};
  const requestedGuild = single(params.guild);
  const guild = guilds.find((item) => item.id === requestedGuild) ?? guilds[0];
  const requestedMetric = single(params.metric);
  const metric: Metric = metrics.includes(requestedMetric as Metric)
    ? (requestedMetric as Metric)
    : 'messages';
  const range = single(params.range) === '30' ? 30 : 7;

  if (!guild) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        管理可能なDiscordサーバーがありません。
      </div>
    );
  }

  const start = jstPeriodStart(range);
  const [rows, totals, activeUsers] = await Promise.all([
    prisma.communityActivityDaily.groupBy({
      by: ['userId'],
      where: { guildId: guild.id, metric, activityDate: { gte: start } },
      _sum: { value: true },
      orderBy: { _sum: { value: 'desc' } },
      take: 25,
    }),
    prisma.communityActivityDaily.groupBy({
      by: ['metric'],
      where: { guildId: guild.id, activityDate: { gte: start } },
      _sum: { value: true },
    }),
    prisma.communityActivityDaily.findMany({
      where: { guildId: guild.id, activityDate: { gte: start } },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const totalMap = new Map(
    totals.map((item) => [item.metric, Number(item._sum.value ?? 0n)]),
  );
  const top = rows.map((row) => ({
    userId: row.userId,
    total: Number(row._sum.value ?? 0n),
  }));
  const max = Math.max(...top.map((item) => item.total), 1);
  const summaryCards: SummaryCard[] = [
    {
      label: '発言',
      value: totalMap.get('messages') ?? 0,
      icon: MessageSquare,
    },
    {
      label: 'VC',
      value: totalMap.get('voice_seconds') ?? 0,
      icon: Mic2,
      duration: true,
    },
    {
      label: 'リアクション',
      value: totalMap.get('reactions_given') ?? 0,
      icon: Sparkles,
    },
    {
      label: 'アクティブメンバー',
      value: activeUsers.length,
      icon: Users,
    },
  ];

  const queryHref = (overrides: Record<string, string>) => {
    const query = new URLSearchParams({
      guild: guild.id,
      metric,
      range: String(range),
      ...overrides,
    });
    return `/dashboard/community?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Community Insights
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            コミュニティ・リーダーボード
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            発言、VC、リアクションを同じ日次メトリクス基盤で集計。Minecraftプレイ時間も同じ形式で接続できます。
          </p>
        </div>

        <form className="flex flex-wrap gap-2" action="/dashboard/community">
          <select
            name="guild"
            defaultValue={guild.id}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          >
            {guilds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            name="range"
            defaultValue={String(range)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="7">7日間</option>
            <option value="30">30日間</option>
          </select>
          <input type="hidden" name="metric" value={metric} />
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white">
            更新
          </button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon, duration }) => (
          <section
            key={label}
            className="rounded-2xl border border-border bg-surface p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">{label}</p>
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-2xl font-semibold">
              {duration ? formatSeconds(value) : value.toLocaleString('ja-JP')}
            </p>
            <p className="mt-1 text-xs text-muted">過去{range}日</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="font-medium">ランキング</h2>
            </div>
            <p className="mt-1 text-sm text-muted">上位25人を表示します。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {metrics.map((item) => (
              <Link
                key={item}
                href={queryHref({ metric: item })}
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  item === metric
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-muted hover:text-foreground'
                }`}
              >
                {metricLabels[item]}
              </Link>
            ))}
          </div>
        </div>

        {top.length === 0 ? (
          <p className="mt-8 text-sm text-muted">この期間の活動データはまだありません。</p>
        ) : (
          <div className="mt-6 space-y-3">
            {top.map((item, index) => (
              <div
                key={item.userId}
                className="rounded-xl border border-border bg-background p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="truncate text-sm font-medium">
                    <span className="mr-2 text-muted">#{index + 1}</span>
                    Discord ID: {item.userId}
                  </p>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMetric(metric, item.total)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(3, (item.total / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Pickaxe className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h2 className="font-medium">Minecraft連携に対応できるメトリクス基盤</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              minecraft_secondsを予約済みです。Discord IDとMinecraft UUIDのリンク、署名付きAgent/APIを追加すると、同じランキングとプロフィールへプレイ時間を表示できます。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
