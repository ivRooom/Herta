import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Crown,
  Gauge,
  Medal,
  MessageSquareText,
  Mic2,
  Pickaxe,
  Sparkles,
  Star,
  Trophy,
  Users,
} from 'lucide-react';
import { auth } from '@/auth';
import { searchGuildMembers, type GuildMemberOption } from '@/lib/bot-guild-members';
import {
  COMMUNITY_LEADERBOARD_DEFINITIONS,
  communityLeaderboardPeriodLabel,
  formatCommunityLeaderboardValue,
  getCommunityLeaderboardDefinition,
  normalizeCommunityLeaderboardQuery,
  type CommunityLeaderboardMetric,
} from '@/lib/community-leaderboard-core';
import { getCommunityLeaderboardSnapshot } from '@/lib/community-leaderboard';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CommunityLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { guildId } = await params;
  const queryParams = await searchParams;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const query = normalizeCommunityLeaderboardQuery({
    metric: first(queryParams.metric),
    period: first(queryParams.period),
    limit: first(queryParams.limit),
  });
  const definition = getCommunityLeaderboardDefinition(query.metric);
  const snapshot = await getCommunityLeaderboardSnapshot(guildId, query);
  const memberMap = await resolveMemberNames(
    guildId,
    snapshot.entries.slice(0, 10).map((entry) => entry.userId),
  );
  const topEntry = snapshot.entries[0];

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/guilds/${guildId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {guild.name}へ戻る
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Trophy className="h-5 w-5" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em]">Leaderboard v2</p>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Community Leaderboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              XPだけでなく、発言・Reaction・VC・Minecraft・Achievement・Season
              Pointを同じ画面で比較できます。
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm">
            <p className="text-xs text-muted">現在のランキング</p>
            <p className="mt-1 font-semibold">
              {definition.label} · {communityLeaderboardPeriodLabel(snapshot.period)}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Users}
          label="参加メンバー"
          value={snapshot.participants.toLocaleString()}
          detail="このカテゴリで記録がある人数"
        />
        <SummaryCard
          icon={Crown}
          label="現在の1位"
          value={topEntry ? displayName(memberMap.get(topEntry.userId), topEntry.userId) : '—'}
          detail={
            topEntry
              ? formatEntryValue(query.metric, topEntry.value, topEntry.secondaryValue)
              : 'データなし'
          }
        />
        <SummaryCard
          icon={Gauge}
          label="集計期間"
          value={communityLeaderboardPeriodLabel(snapshot.period)}
          detail={definition.description}
        />
        <SummaryCard
          icon={Sparkles}
          label="Season"
          value={snapshot.seasonKey ?? '—'}
          detail={snapshot.seasonKey ? '現在のChallenge Season' : 'Season外カテゴリ'}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Category</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {COMMUNITY_LEADERBOARD_DEFINITIONS.map((candidate) => {
            const active = candidate.metric === query.metric;
            return (
              <Link
                key={candidate.metric}
                href={leaderboardHref(
                  guildId,
                  candidate.metric,
                  candidate.periods[0]!,
                  query.limit,
                )}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-background/60 text-muted hover:text-foreground'
                }`}
              >
                {candidate.shortLabel}
              </Link>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            {definition.periods.map((period) => (
              <Link
                key={period}
                href={leaderboardHref(guildId, query.metric, period, query.limit)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  period === query.period
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted hover:text-foreground'
                }`}
              >
                {communityLeaderboardPeriodLabel(period)}
              </Link>
            ))}
          </div>
          <div className="flex gap-2">
            {[10, 25].map((limit) => (
              <Link
                key={limit}
                href={leaderboardHref(guildId, query.metric, query.period, limit as 10 | 25)}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  query.limit === limit ? 'bg-primary/10 font-semibold text-primary' : 'text-muted'
                }`}
              >
                Top {limit}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {snapshot.entries.length > 0 ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            {snapshot.entries.slice(0, 3).map((entry) => (
              <PodiumCard
                key={entry.userId}
                rank={entry.rank}
                name={displayName(memberMap.get(entry.userId), entry.userId)}
                userId={entry.userId}
                value={formatEntryValue(query.metric, entry.value, entry.secondaryValue)}
              />
            ))}
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">{definition.label} Ranking</h2>
                <p className="mt-1 text-xs text-muted">
                  同値の場合はDiscord User ID順で安定して表示します。
                </p>
              </div>
              <MetricIcon metric={query.metric} />
            </div>
            <div className="divide-y divide-border">
              {snapshot.entries.map((entry) => {
                const member = memberMap.get(entry.userId);
                return (
                  <div
                    key={entry.userId}
                    className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4"
                  >
                    <span className="text-center text-sm font-semibold text-muted">
                      #{entry.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {displayName(member, entry.userId)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">{entry.userId}</p>
                    </div>
                    <span className="text-right text-sm font-semibold">
                      {formatEntryValue(query.metric, entry.value, entry.secondaryValue)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <Trophy className="mx-auto h-8 w-8 text-muted" />
          <h2 className="mt-4 font-semibold">まだランキングデータがありません</h2>
          <p className="mt-2 text-sm text-muted">
            このカテゴリの活動が記録されると、ここに順位が表示されます。
          </p>
        </section>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function PodiumCard({
  rank,
  name,
  userId,
  value,
}: {
  rank: number;
  name: string;
  userId: string;
  value: string;
}) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-2xl" aria-label={`${rank}位`}>
          {medal}
        </span>
        <span className="text-xs font-semibold text-muted">#{rank}</span>
      </div>
      <p className="mt-4 truncate font-semibold">{name}</p>
      <p className="mt-1 truncate text-xs text-muted">{userId}</p>
      <p className="mt-4 text-lg font-semibold text-primary">{value}</p>
    </article>
  );
}

function MetricIcon({ metric }: { metric: CommunityLeaderboardMetric }) {
  const Icon =
    metric === 'messages'
      ? MessageSquareText
      : metric === 'voice'
        ? Mic2
        : metric === 'minecraft'
          ? Pickaxe
          : metric === 'achievements'
            ? Medal
            : metric === 'season'
              ? Star
              : Trophy;
  return <Icon className="h-5 w-5 text-primary" />;
}

function formatEntryValue(
  metric: CommunityLeaderboardMetric,
  value: number,
  secondaryValue: number | null,
): string {
  return formatCommunityLeaderboardValue(metric, value, secondaryValue);
}

function leaderboardHref(
  guildId: string,
  metric: CommunityLeaderboardMetric,
  period: string,
  limit: 10 | 25,
): string {
  const params = new URLSearchParams({ metric, period, limit: String(limit) });
  return `/dashboard/guilds/${guildId}/leaderboard?${params.toString()}`;
}

async function resolveMemberNames(
  guildId: string,
  userIds: string[],
): Promise<Map<string, GuildMemberOption>> {
  const resolved = await Promise.all(
    userIds.map(async (userId) => {
      const members = await searchGuildMembers(guildId, userId, 1);
      return [userId, members?.[0] ?? null] as const;
    }),
  );
  return new Map(
    resolved.flatMap(([userId, member]) => (member ? [[userId, member] as const] : [])),
  );
}

function displayName(member: GuildMemberOption | undefined, userId: string): string {
  if (member) return member.displayName || member.username;
  return `User ${userId.slice(-6)}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
