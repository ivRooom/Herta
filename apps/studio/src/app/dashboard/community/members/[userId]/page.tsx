import Link from 'next/link';
import { ArrowLeft, Coins, Gamepad2, History, Sparkles } from 'lucide-react';
import { redirect } from 'next/navigation';
import {
  getCommunityUserDailySeries,
  getCommunityUserGameBreakdown,
  getCommunityUserMetricTotals,
  getCommunityUserPointsBreakdown,
} from '@herta/db';
import {
  communityPointsRatesFromConfig,
  normalizeActivityRulesConfig,
} from '@herta/shared/activity-rules';
import { resolveGuildMemberDisplays } from '@/lib/bot-guild-members';
import {
  COMMUNITY_METRICS as metrics,
  COMMUNITY_METRIC_LABELS as metricLabels,
  communityDateKey as dateKey,
  displayCommunityDate as displayDate,
  formatCommunityMetric as formatMetric,
  resolveCommunityBucketDays as resolveBucketDays,
  type CommunityMetric as Metric,
} from '@/lib/community-metrics';
import {
  COMMUNITY_CUSTOM_RANGE_MAX_DAYS as CUSTOM_RANGE_MAX_DAYS,
  COMMUNITY_DEFAULT_PERIOD as DEFAULT_PERIOD,
  COMMUNITY_PERIOD_PRESETS as PERIOD_PRESETS,
  communityJstToday as jstToday,
  communityPeriodLabel as periodLabel,
  resolveCommunityPeriodRange as resolvePeriodRange,
} from '@/lib/community-period';
import { getGuildPlugin } from '@/lib/guild-plugins';
import { DiscordMemberIdentity } from '@/components/discord-member-identity';
import { PeriodRangePicker } from '@/components/period-range-picker';
import { prisma } from '@/lib/db';
import { getManageableGuilds } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const POINTS_SOURCE_LABELS: Record<string, string> = {
  messages: '発言',
  reactions_given: 'リアクション(送信)',
  reactions_received: 'リアクション(被)',
  voice_seconds: 'VC滞在',
  online_seconds: 'オンライン',
  commands: 'コマンド利用',
  lfg_joins: 'LFG参加',
  team_split_joins: 'Team Split参加',
  poll_votes: '投票',
  game: 'ゲームプレイ',
  achievement: '実績解除',
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function CommunityMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const accessToken = await getDiscordAccessToken();
  if (!accessToken) redirect('/login');

  const { userId } = await params;
  const guilds = await getManageableGuilds(accessToken);
  const query = (await searchParams) ?? {};
  const requestedGuild = single(query.guild);
  const guild = guilds.find((item) => item.id === requestedGuild) ?? guilds[0];
  const requestedMetric = single(query.metric);
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

  const requestedPeriod = single(query.period) || DEFAULT_PERIOD;
  const customFromParam = single(query.from) || undefined;
  const customToParam = single(query.to) || undefined;
  const { period, start, end } = resolvePeriodRange(
    requestedPeriod,
    customFromParam,
    customToParam,
  );
  const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const activityRulesPlugin = await getGuildPlugin(guild.id, 'activity-rules');
  const pointsRates = communityPointsRatesFromConfig(
    normalizeActivityRulesConfig(activityRulesPlugin?.config),
  );

  const [memberMap, metricTotals, dailySeries, gameBreakdown, pointsBreakdown] = await Promise.all([
    resolveGuildMemberDisplays(guild.id, [userId]),
    getCommunityUserMetricTotals(prisma, { guildId: guild.id, userId, start, end }),
    getCommunityUserDailySeries(prisma, { guildId: guild.id, userId, metric, start, end }),
    getCommunityUserGameBreakdown(prisma, { guildId: guild.id, userId, start, end, limit: 10 }),
    getCommunityUserPointsBreakdown(prisma, {
      guildId: guild.id,
      userId,
      start,
      end,
      rates: pointsRates,
    }),
  ]);

  const member = memberMap.get(userId);
  const totalMap = new Map(metricTotals.map((item) => [item.metric, item.value]));
  const totalPoints = pointsBreakdown.reduce((sum, item) => sum + item.points, 0);
  const gameMax = Math.max(...gameBreakdown.map((item) => item.value), 1);

  const dailyMap = new Map(dailySeries.map((item) => [dateKey(item.activityDate), item.value]));
  const bucketDays = resolveBucketDays(rangeDays);
  const bucketCount = Math.ceil(rangeDays / bucketDays);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(start.getTime() + index * bucketDays * 86_400_000);
    let value = 0;
    for (let dayOffset = 0; dayOffset < bucketDays; dayOffset += 1) {
      const day = new Date(bucketStart.getTime() + dayOffset * 86_400_000);
      if (day.getTime() > end.getTime()) break;
      value += dailyMap.get(dateKey(day)) ?? 0;
    }
    return { date: bucketStart, value };
  });
  const bucketMax = Math.max(...buckets.map((item) => item.value), 1);

  const queryHref = (overrides: Record<string, string>) => {
    const query = new URLSearchParams({ guild: guild.id, metric, period, ...overrides });
    return `/dashboard/community/members/${userId}?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/community?guild=${guild.id}&period=${period}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        統計ダッシュボードへ戻る
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
          <DiscordMemberIdentity member={member} userId={userId} size="md" />
        </div>
        <PeriodRangePicker
          basePath={`/dashboard/community/members/${userId}`}
          preservedParams={{ guild: guild.id, metric }}
          presets={PERIOD_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
          activePeriod={period}
          customFrom={customFromParam}
          customTo={customToParam}
          maxDate={dateKey(jstToday())}
          minDate={dateKey(new Date(jstToday().getTime() - CUSTOM_RANGE_MAX_DAYS * 86_400_000))}
        />
      </div>
      <p className="text-sm text-muted">{periodLabel({ period, start, end })}の統計です。</p>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-medium">メトリクス合計</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((item) => (
            <div key={item} className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs text-muted">{metricLabels[item]}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {formatMetric(item, totalMap.get(item) ?? 0)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h2 className="font-medium">日次推移</h2>
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
        {buckets.every((item) => item.value === 0) ? (
          <p className="mt-6 text-sm text-muted">この期間の活動データはまだありません。</p>
        ) : (
          <div className="mt-6 flex h-40 items-end gap-1">
            {buckets.map((item, index) => {
              const showLabel = bucketCount <= 20 || index % Math.ceil(bucketCount / 10) === 0;
              return (
                <div key={dateKey(item.date)} className="flex flex-1 flex-col items-center">
                  <div
                    className="w-full rounded-t bg-primary/70"
                    style={{ height: `${Math.max(2, (item.value / bucketMax) * 100)}%` }}
                    title={`${displayDate(item.date)}: ${formatMetric(metric, item.value)}`}
                  />
                  <span className="mt-2 h-4 text-[10px] text-muted">
                    {showLabel ? displayDate(item.date) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <h2 className="font-medium">ポイント内訳</h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            期間内合計:{' '}
            <span className="font-semibold text-primary">
              {totalPoints.toLocaleString('ja-JP')} pt
            </span>
          </p>
          {pointsBreakdown.length === 0 ? (
            <p className="mt-6 text-sm text-muted">この期間のポイントデータはまだありません。</p>
          ) : (
            <div className="mt-4 space-y-2">
              {pointsBreakdown.map((item) => (
                <div key={item.source} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">
                    {POINTS_SOURCE_LABELS[item.source] ?? item.source}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {item.points.toLocaleString('ja-JP')} pt
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-primary" />
            <h2 className="font-medium">よく遊んでいるゲーム・アプリ</h2>
          </div>
          {gameBreakdown.length === 0 ? (
            <p className="mt-6 text-sm text-muted">この期間のプレイ記録はまだありません。</p>
          ) : (
            <div className="mt-4 space-y-2">
              {gameBreakdown.map((item) => (
                <div key={item.activityName} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm text-muted sm:w-40">
                    {item.activityName}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(3, (item.value / gameMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold">
                    {formatMetric('voice_seconds', item.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
