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
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getCommunityActiveUserCounts, getCommunityNewVsReturningUsers } from '@herta/db';
import { resolveGuildMemberDisplays } from '@/lib/bot-guild-members';
import { DiscordMemberIdentity } from '@/components/discord-member-identity';
import { PeriodRangePicker } from '@/components/period-range-picker';
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

const PERIOD_PRESETS = [
  { value: '1d', label: '今日', days: 1 },
  { value: '7d', label: '直近7日', days: 7 },
  { value: '14d', label: '直近2週間', days: 14 },
  { value: '30d', label: '直近30日', days: 30 },
  { value: '90d', label: '直近3ヶ月', days: 90 },
  { value: '180d', label: '直近6ヶ月', days: 180 },
  { value: '365d', label: '直近1年', days: 365 },
  { value: '3y', label: '直近3年', days: 1_095 },
  { value: '5y', label: '直近5年', days: 1_825 },
  { value: '10y', label: '直近10年', days: 3_650 },
] as const;
const CUSTOM_RANGE_MAX_DAYS = 3_653;
const DEFAULT_PERIOD = '7d';

function jstToday(now = new Date()): Date {
  const key = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** period/from/toから{period,start,end}を解決する。不正なcustom rangeは既定periodへfail closedする。 */
function resolvePeriodRange(
  period: string,
  from: string | undefined,
  to: string | undefined,
): { period: string; start: Date; end: Date } {
  const today = jstToday();
  if (period === 'custom') {
    const start = parseDateOnly(from);
    const end = parseDateOnly(to);
    if (start && end && end.getTime() >= start.getTime()) {
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (days >= 1 && days <= CUSTOM_RANGE_MAX_DAYS && end.getTime() <= today.getTime()) {
        return { period: 'custom', start, end };
      }
    }
    return resolvePeriodRange(DEFAULT_PERIOD, undefined, undefined);
  }
  const preset = PERIOD_PRESETS.find((candidate) => candidate.value === period);
  const days =
    preset?.days ?? PERIOD_PRESETS.find((candidate) => candidate.value === DEFAULT_PERIOD)!.days;
  return {
    period: preset?.value ?? DEFAULT_PERIOD,
    start: new Date(today.getTime() - (days - 1) * 86_400_000),
    end: today,
  };
}

function periodLabel(range: { period: string; start: Date; end: Date }): string {
  if (range.period === 'custom') {
    return `${dateKey(range.start)} 〜 ${dateKey(range.end)}`;
  }
  return (
    PERIOD_PRESETS.find((candidate) => candidate.value === range.period)?.label ?? range.period
  );
}

/** チャートの棒が多くなりすぎないよう、期間の長さに応じて日次/週次/月次で束ねる。 */
function resolveBucketDays(rangeDays: number): number {
  if (rangeDays <= 60) return 1;
  if (rangeDays <= 400) return 7;
  return 30;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function displayDate(value: Date): string {
  const [, month, day] = dateKey(value).split('-');
  return `${Number(month)}/${Number(day)}`;
}

function comparisonLabel(
  current: number,
  previous: number,
): {
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

  if (!guild) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        管理可能なDiscordサーバーがありません。
      </div>
    );
  }

  const requestedPeriod = single(params.period) || DEFAULT_PERIOD;
  const customFromParam = single(params.from) || undefined;
  const customToParam = single(params.to) || undefined;
  const { period, start, end } = resolvePeriodRange(
    requestedPeriod,
    customFromParam,
    customToParam,
  );
  const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - (rangeDays - 1) * 86_400_000);

  const [rows, totals, activeUsers, dailyRows, previousRows, activeUserCounts, newVsReturning] =
    await Promise.all([
      prisma.communityActivityDaily.groupBy({
        by: ['userId'],
        where: { guildId: guild.id, metric, activityDate: { gte: start, lte: end } },
        _sum: { value: true },
        orderBy: [{ _sum: { value: 'desc' } }, { userId: 'asc' }],
        take: 25,
      }),
      prisma.communityActivityDaily.groupBy({
        by: ['metric'],
        where: { guildId: guild.id, activityDate: { gte: start, lte: end } },
        _sum: { value: true },
      }),
      prisma.communityActivityDaily.findMany({
        where: { guildId: guild.id, activityDate: { gte: start, lte: end } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      prisma.communityActivityDaily.groupBy({
        by: ['activityDate'],
        where: { guildId: guild.id, metric, activityDate: { gte: start, lte: end } },
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
      getCommunityActiveUserCounts(prisma, { guildId: guild.id, asOf: end }),
      getCommunityNewVsReturningUsers(prisma, { guildId: guild.id, start, end }),
    ]);

  const totalMap = new Map(totals.map((item) => [item.metric, Number(item._sum.value ?? 0n)]));
  const top = rows.map((row) => ({
    userId: row.userId,
    total: Number(row._sum.value ?? 0n),
  }));

  const memberMap = top.length
    ? await resolveGuildMemberDisplays(
        guild.id,
        top.map((item) => item.userId),
      )
    : new Map();

  const max = Math.max(...top.map((item) => item.total), 1);
  const selectedTotal = totalMap.get(metric) ?? 0;
  const previousTotal = Number(previousRows[0]?._sum.value ?? 0n);
  const comparison = comparisonLabel(selectedTotal, previousTotal);

  const dailyMap = new Map(
    dailyRows.map((row) => [dateKey(row.activityDate), Number(row._sum.value ?? 0n)]),
  );
  const bucketDays = resolveBucketDays(rangeDays);
  const bucketCount = Math.ceil(rangeDays / bucketDays);
  const daily = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + index * bucketDays * 86_400_000);
    const bucketEnd = new Date(
      Math.min(bucketStart.getTime() + (bucketDays - 1) * 86_400_000, end.getTime()),
    );
    let value = 0;
    for (let cursor = bucketStart.getTime(); cursor <= bucketEnd.getTime(); cursor += 86_400_000) {
      value += dailyMap.get(dateKey(new Date(cursor))) ?? 0;
    }
    return { date: bucketStart, endDate: bucketEnd, value };
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
      period,
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
  const periodText = periodLabel({ period, start, end });

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
          <input type="hidden" name="metric" value={metric} />
          <input type="hidden" name="period" value={period} />
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white">
            サーバーを切替
          </button>
        </form>
      </div>

      <PeriodRangePicker
        basePath="/dashboard/community"
        preservedParams={{ guild: guild.id, metric }}
        presets={PERIOD_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
        activePeriod={period}
        customFrom={customFromParam}
        customTo={customToParam}
        maxDate={dateKey(jstToday())}
        minDate={dateKey(new Date(jstToday().getTime() - CUSTOM_RANGE_MAX_DAYS * 86_400_000))}
      />

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
            <p className="mt-1 text-xs text-muted">{periodText}</p>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="font-medium">アクティブユーザー</h2>
        </div>
        <p className="mt-1 text-sm text-muted">
          {dateKey(end)}時点のDAU/WAU/MAU、および選択期間内の新規・復帰ユーザー内訳。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ActiveUserStat label="DAU" sublabel="当日" value={activeUserCounts.dau} />
          <ActiveUserStat label="WAU" sublabel="直近7日" value={activeUserCounts.wau} />
          <ActiveUserStat label="MAU" sublabel="直近30日" value={activeUserCounts.mau} />
          <ActiveUserStat
            label="新規"
            sublabel="期間内が初活動"
            value={newVsReturning.newUsers}
            icon={UserPlus}
          />
          <ActiveUserStat
            label="復帰/継続"
            sublabel="期間前から活動歴あり"
            value={newVsReturning.returningUsers}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="font-medium">{metricLabels[metric]}の推移</h2>
            </div>
            <p className="mt-1 text-sm text-muted">
              {bucketDays === 1 ? '日次' : bucketDays === 7 ? '週次' : '月次'}
              合計と直前の同期間を比較します。
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3 text-right">
            <p className="text-xs text-muted">{periodText}</p>
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
            const labelStep = Math.max(1, Math.ceil(daily.length / 10));
            const showLabel = index % labelStep === 0 || index === daily.length - 1;
            const rangeLabel =
              bucketDays === 1
                ? displayDate(item.date)
                : `${displayDate(item.date)}〜${displayDate(item.endDate)}`;
            const accessibleLabel = `${rangeLabel}: ${formatMetric(metric, item.value)}`;
            return (
              <div
                key={dateKey(item.date)}
                className="flex min-w-0 flex-1 flex-col items-center justify-end"
              >
                <div
                  className="group relative flex h-36 w-full items-end justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  role="img"
                  aria-label={accessibleLabel}
                  tabIndex={0}
                >
                  <div
                    className="w-full max-w-8 rounded-t-md bg-primary/80 transition-opacity hover:opacity-80"
                    style={{ height: `${height}%` }}
                    title={accessibleLabel}
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
            <p className="mt-1 text-sm text-muted">
              上位25人を表示します。Botでは /activity-rank で個人順位を確認できます。
            </p>
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
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-sm text-muted">#{index + 1}</span>
                    <DiscordMemberIdentity
                      member={memberMap.get(item.userId)}
                      userId={item.userId}
                    />
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

function ActiveUserStat({
  label,
  sublabel,
  value,
  icon: Icon = Users,
}: {
  label: string;
  sublabel: string;
  value: number;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-2 text-xl font-semibold">{value.toLocaleString('ja-JP')}</p>
      <p className="mt-1 text-[11px] text-muted">{sublabel}</p>
    </div>
  );
}
