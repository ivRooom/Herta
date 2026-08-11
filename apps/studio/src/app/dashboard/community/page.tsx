import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  MessageSquare,
  Mic2,
  Pickaxe,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const metrics = [
  'messages',
  'voice_seconds',
  'reactions_given',
  'reactions_received',
  'minecraft_seconds',
] as const;
type Metric = (typeof metrics)[number];

const metricLabels: Record<Metric, string> = {
  messages: '発言数',
  voice_seconds: 'VC滞在時間',
  reactions_given: 'リアクション',
  reactions_received: 'もらったリアクション',
  minecraft_seconds: 'Minecraft',
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

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function displayDate(value: Date): string {
  const [, month, day] = dateKey(value).split('-');
  return `${Number(month)}/${Number(day)}`;
}

function comparisonLabel(current: number, previous: number): {
  label: string;
  tone: 'up' | 'down' | 'flat';
} {
  if (previous === 0) {
    if (current === 0) return { label: '前期間と同じ', tone: 'flat' };
    return { label: '前期間は記録なし', tone: 'up' };
  }
  const rate = ((current - previous) / previous) * 100;
  if (Math.abs(rate) < 0.05) return { label: '前期間比 ±0%', tone: 'flat' };
  return {
    label: `前期間比 ${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`,
    tone: rate > 0 ? 'up' : 'down',
  };
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
  const previousStart = new Date(start.getTime() - range * 86_400_000);
  const previousEnd = new Date(start.getTime() - 1);

  const [rows, totals, activeUsers, dailyRows, previousRows] = await Promise.all([
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
    prisma.communityActivityDaily.groupBy({
      by: ['activityDate'],
      where: { guildId: guild.id, metric, activityDate: { gte: start } },
      _sum: { value: true },
      orderBy: { activityDate: 'asc' },
    }),
    prisma.communityActivityDaily.groupBy({
      by: ['metric'],
      where: {
        guildId: guild.id,
        metric,
        activityDate: { gte: previousStart, lte: previousEnd },
      },
      _sum: { value: true },
    }),
  ]);

  const totalMap = new Map(totals.map((item) => [item.metric, Number(item._sum.value ?? 0n)]));
  const top = rows.map((row) => ({
    userId: row.userId,
    total: Number(row._sum.value ?? 0n),
  }));

  const users = top.length
    ? await prisma.user.findMany({
        where: { id: { in: top.map((item) => item.userId) } },
        select: { id: true, username: true },
      })
    : [];
  const userNames = new Map(users.map((user) => [user.id, user.username]));

  const max = Math.max(...top.map((item) => item.total), 1);
  const selectedTotal = totalMap.get(metric) ?? 0;
  const previousTotal = Number(previousRows[0]?._sum.value ?? 0n);
  const comparison = comparisonLabel(selectedTotal, previousTotal);

  const dailyMap = new Map(
    dailyRows.map((row) => [dateKey(row.activityDate), Number(row._sum.value ?? 0n)]),
  );
  const daily = Array.from({ length: range }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    return { date, value: dailyMap.get(dateKey(date)) ?? 0 };
  });
  const dailyMax = Math.max(...daily.map((item) => item.value), 1);

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

  const ComparisonIcon =
    comparison.tone === 'up'
      ? ArrowUpRight
      : comparison.tone === 'down'
        ? ArrowDownRight
        : ArrowRight;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Community Insights v2
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">コミュニティ分析</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            発言、VC、リアクションを日次で可視化し、ランキングと前期間比較をまとめて確認できます。
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="font-medium">{metricLabels[metric]}の推移</h2>
            </div>
            <p className="mt-1 text-sm text-muted">日次合計と直前の同期間を比較します。</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3 text-right">
            <p className="text-xs text-muted">過去{range}日</p>
            <p className="mt-1 text-xl font-semibold">{formatMetric(metric, selectedTotal)}</p>
            <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted">
              <ComparisonIcon className="h-3.5 w-3.5" />
              <span>{comparison.label}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex h-48 items-end gap-1 rounded-xl border border-border bg-background p-4 sm:gap-2">
          {daily.map((item, index) => {
            const height = item.value === 0 ? 2 : Math.max(6, (item.value / dailyMax) * 100);
            const showLabel = range === 7 || index % 5 === 0 || index === range - 1;
            return (
              <div key={dateKey(item.date)} className="flex min-w-0 flex-1 flex-col items-center justify-end">
                <div className="group relative flex h-36 w-full items-end justify-center">
                  <div
                    className="w-full max-w-8 rounded-t-md bg-primary/80 transition-opacity hover:opacity-80"
                    style={{ height: `${height}%` }}
                    title={`${displayDate(item.date)}: ${formatMetric(metric, item.value)}`}
                  />
                </div>
                <span className="mt-2 h-4 text-[10px] text-muted">
                  {showLabel ? displayDate(item.date) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="font-medium">ランキング</h2>
            </div>
            <p className="mt-1 text-sm text-muted">上位25人を表示します。Botでは /rank で個人順位を確認できます。</p>
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
              <div key={item.userId} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="mr-2 text-muted">#{index + 1}</span>
                      {userNames.get(item.userId) ?? `Discord ID: ${item.userId}`}
                    </p>
                    {userNames.has(item.userId) ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted">{item.userId}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
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
            <h2 className="font-medium">Minecraft連携の受け口を維持</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              minecraft_secondsはランキングと日次推移の対象に含めています。Minecraft側から活動データが投入されると、この画面へ自動的に統合されます。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
