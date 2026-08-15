import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
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
  communityLeaderboardSeasonDaysRemaining,
  communityLeaderboardSeasonStatus,
  formatCommunityLeaderboardValue,
  getCommunityLeaderboardDefinition,
  listCommunityLeaderboardSeasons,
  normalizeCommunityLeaderboardQuery,
  resolveCommunityLeaderboardSeason,
  type CommunityLeaderboardMetric,
  type CommunitySeasonWindow,
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
  const now = new Date();
  const seasons = listCommunityLeaderboardSeasons(now);
  const currentSeason = seasons[0]!;
  const selectedSeason = resolveCommunityLeaderboardSeason(first(queryParams.season), now);
  const snapshot = await getCommunityLeaderboardSnapshot(guildId, query, now, {
    seasonKey: query.metric === 'season' ? selectedSeason.key : null,
    viewerUserId: session.user.id ?? null,
  });
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
              <p className="text-xs font-semibold uppercase tracking-[0.18em]">
                Leaderboard v3 · Seasons
              </p>
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
          label={query.metric === 'season' ? '選択中Season' : 'Current Season'}
          value={`Season ${query.metric === 'season' ? selectedSeason.index : currentSeason.index}`}
          detail={formatSeasonDateRange(query.metric === 'season' ? selectedSeason : currentSeason)}
        />
        <SummaryCard
          icon={Medal}
          label="あなたの順位"
          value={snapshot.viewerRank ? `#${snapshot.viewerRank.rank}` : '—'}
          detail={
            snapshot.viewerRank
              ? `${formatEntryValue(
                  query.metric,
                  snapshot.viewerRank.value,
                  snapshot.viewerRank.secondaryValue,
                )} · ${snapshot.participants}人中`
              : 'このカテゴリではまだ記録がありません'
          }
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
                  candidate.metric === 'season' ? selectedSeason.key : null,
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
                href={leaderboardHref(
                  guildId,
                  query.metric,
                  period,
                  query.limit,
                  query.metric === 'season' ? selectedSeason.key : null,
                )}
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
                href={leaderboardHref(
                  guildId,
                  query.metric,
                  query.period,
                  limit as 10 | 25,
                  query.metric === 'season' ? selectedSeason.key : null,
                )}
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

      {query.metric === 'season' ? (
        <section
          aria-labelledby="season-archive-title"
          className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p id="season-archive-title" className="font-semibold">
                Season Archive
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                現在と過去5シーズンを切り替えて、Season PointとChampionを比較できます。
              </p>
            </div>
            <span
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                communityLeaderboardSeasonStatus(selectedSeason, now) === 'current'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-background text-muted'
              }`}
            >
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {communityLeaderboardSeasonStatus(selectedSeason, now) === 'current'
                ? `残り${communityLeaderboardSeasonDaysRemaining(selectedSeason, now)}日`
                : 'Completed'}
            </span>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Season選択">
            {seasons.map((season) => {
              const active = season.key === selectedSeason.key;
              return (
                <Link
                  key={season.key}
                  href={leaderboardHref(guildId, 'season', 'season', query.limit, season.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`min-w-[9.5rem] shrink-0 rounded-xl border px-3 py-2.5 transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-background/60 hover:border-primary/30'
                  }`}
                >
                  <span className="block text-sm font-semibold">Season {season.index}</span>
                  <span
                    className={`mt-1 block text-[11px] ${active ? 'text-primary/80' : 'text-muted'}`}
                  >
                    {formatSeasonDateRange(season)}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl bg-background/60 p-3">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-muted">集計期間</p>
                <p className="mt-1 text-sm font-semibold">
                  {formatSeasonDateRange(selectedSeason)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-background/60 p-3">
              <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted">Season Champion</p>
                <p className="mt-1 truncate text-sm font-semibold">
                  {topEntry ? displayName(memberMap.get(topEntry.userId), topEntry.userId) : '—'}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {topEntry
                    ? formatEntryValue(query.metric, topEntry.value, topEntry.secondaryValue)
                    : 'まだ記録がありません'}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

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
  seasonKey?: string | null,
): string {
  const params = new URLSearchParams({ metric, period, limit: String(limit) });
  if (metric === 'season' && seasonKey) params.set('season', seasonKey);
  return `/dashboard/guilds/${guildId}/leaderboard?${params.toString()}`;
}

function formatSeasonDateRange(season: CommunitySeasonWindow): string {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const inclusiveEnd = new Date(season.endsAt.getTime() - 1);
  return `${formatter.format(season.startsAt)} – ${formatter.format(inclusiveEnd)}`;
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
