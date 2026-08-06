import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Radar,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  getModerationDetectionStats,
  listModerationDetections,
  type ModerationDetectionKind,
  type ModerationDetectionReviewStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { ModerationDetectionReview } from '@/components/moderation-detection-review';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ModerationDetectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { guildId } = await params;
  const query = await searchParams;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();
  if (!session?.user || !accessToken) notFound();

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild) notFound();
  await persistSelectedGuild(guild, session.user.id);
  const plugin = await getGuildPlugin(guildId, 'moderation');
  if (!plugin) notFound();

  const filters = {
    page: parsePositiveInteger(first(query.page)) ?? 1,
    pageSize: 20,
    detectionKind: parseDetectionKind(first(query.kind)),
    reviewStatus: parseReviewStatus(first(query.status)),
    userId: parseDiscordId(first(query.userId)),
    channelId: parseDiscordId(first(query.channelId)),
    from: parseDate(first(query.from), false),
    toExclusive: parseDate(first(query.to), true),
  };

  let loadError: string | null = null;
  let result: Awaited<ReturnType<typeof listModerationDetections>> = EMPTY_RESULT;
  let stats: Awaited<ReturnType<typeof getModerationDetectionStats>> = EMPTY_STATS;
  try {
    [result, stats] = await Promise.all([
      listModerationDetections(prisma as unknown as ModerationPrismaClient, {
        guildId,
        ...filters,
      }),
      getModerationDetectionStats(prisma as unknown as ModerationPrismaClient, {
        guildId,
        detectionKind: filters.detectionKind,
        reviewStatus: filters.reviewStatus,
        userId: filters.userId,
        channelId: filters.channelId,
        from: filters.from,
        toExclusive: filters.toExclusive,
      }),
    ]);
  } catch (error) {
    console.error('Moderation detections page failed to load', error);
    loadError = '自動検知履歴を取得できませんでした。DB migrationを確認してください。';
  }

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Moderation Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">自動検知レビュー</h1>
          </div>
          <p className="mt-2 text-sm text-muted">{guild.name} のobserve-only検知を分類します。</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/guilds/${guildId}/moderation`}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
          >
            ケース履歴
          </Link>
          <span className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            自動検知
          </span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted">
        本文・一致語・正規表現・招待コードは保存していません。ID、種別、件数、長さ、レビュー結果のみ表示します。
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Radar} label="検知件数" value={stats.total} />
        <StatCard icon={ShieldCheck} label="未確認" value={stats.unreviewed} />
        <StatCard icon={ShieldCheck} label="正検知" value={stats.confirmed} />
        <StatCard
          icon={TriangleAlert}
          label="誤検知率"
          value={`${(stats.falsePositiveRate * 100).toFixed(1)}%`}
          detail={`${stats.falsePositive} / ${stats.reviewed}件`}
        />
      </div>

      <form className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-6">
        <FilterSelect name="kind" label="検知種別" defaultValue={filters.detectionKind ?? ''}>
          <option value="">すべて</option>
          {DETECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect name="status" label="レビュー状態" defaultValue={filters.reviewStatus ?? ''}>
          <option value="">すべて</option>
          <option value="unreviewed">未確認</option>
          <option value="confirmed">正検知</option>
          <option value="false_positive">誤検知</option>
          <option value="ignored">無視</option>
        </FilterSelect>
        <FilterInput name="userId" label="ユーザーID" defaultValue={filters.userId} />
        <FilterInput name="channelId" label="チャンネルID" defaultValue={filters.channelId} />
        <FilterInput name="from" label="開始日" defaultValue={first(query.from)} type="date" />
        <FilterInput name="to" label="終了日" defaultValue={first(query.to)} type="date" />
        <div className="flex items-end justify-end gap-2 md:col-span-6">
          <Link
            href={`/dashboard/guilds/${guildId}/moderation/detections`}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-background"
          >
            リセット
          </Link>
          <button
            type="submit"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            絞り込む
          </button>
        </div>
      </form>

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : result.items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          条件に一致する自動検知履歴はありません。
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-background/60 text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">日時 / 種別</th>
                  <th className="px-4 py-3 font-medium">対象</th>
                  <th className="px-4 py-3 font-medium">観測値</th>
                  <th className="px-4 py-3 font-medium">状態</th>
                  <th className="px-4 py-3 font-medium">レビュー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-background/60">
                    <td className="px-4 py-4">
                      <div className="font-medium">{kindLabel(item.detectionKind)}</div>
                      <div className="mt-1 whitespace-nowrap text-xs text-muted">
                        {formatDate(item.occurredAt)}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      <div>User: {item.userId}</div>
                      <div className="mt-1 text-muted">Channel: {item.channelId}</div>
                      <div className="mt-1 text-muted">Message: {item.messageId}</div>
                    </td>
                    <td className="px-4 py-4 text-muted">
                      <div>本文長: {item.messageLength}</div>
                      <div className="mt-1 text-xs">
                        観測: {item.observedCount ?? '—'} / 閾値: {item.threshold ?? '—'}
                      </div>
                      <div className="mt-1 text-xs">Rule: {item.ruleIndex ?? '—'}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={statusClassName(item.reviewStatus)}>
                        {statusLabel(item.reviewStatus)}
                      </span>
                      {item.reviewedAt ? (
                        <div className="mt-2 text-xs text-muted">{formatDate(item.reviewedAt)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <ModerationDetectionReview
                        guildId={guildId}
                        detectionId={item.id}
                        initialStatus={item.reviewStatus}
                        initialNote={item.reviewNote}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav
          className="mt-6 flex items-center justify-center gap-3"
          aria-label="検知履歴ページング"
        >
          {result.page > 1 ? (
            <Link href={buildPageHref(guildId, query, result.page - 1)} className={PAGE_LINK}>
              <ChevronLeft className="h-4 w-4" /> 前へ
            </Link>
          ) : null}
          <span className="text-sm text-muted">
            {result.page} / {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link href={buildPageHref(guildId, query, result.page + 1)} className={PAGE_LINK}>
              次へ <ChevronRight className="h-4 w-4" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

const DETECTION_KINDS: ModerationDetectionKind[] = [
  'word_exact',
  'word_contains',
  'word_regex',
  'invite_link',
  'mention_burst',
  'message_burst',
  'duplicate_message',
];
const PAGE_LINK =
  'inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface';
const EMPTY_RESULT = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
const EMPTY_STATS = {
  total: 0,
  unreviewed: 0,
  confirmed: 0,
  falsePositive: 0,
  ignored: 0,
  reviewed: 0,
  falsePositiveRate: 0,
  kindCounts: {
    word_exact: 0,
    word_contains: 0,
    word_regex: 0,
    invite_link: 0,
    mention_burst: 0,
    message_burst: 0,
    duplicate_message: 0,
  },
};

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Radar;
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted">{detail}</div> : null}
    </div>
  );
}
function FilterInput({
  name,
  label,
  defaultValue,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        inputMode={type === 'text' ? 'numeric' : undefined}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
function FilterSelect({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function parsePositiveInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function parseDetectionKind(value: string | undefined): ModerationDetectionKind | undefined {
  return DETECTION_KINDS.includes(value as ModerationDetectionKind)
    ? (value as ModerationDetectionKind)
    : undefined;
}
function parseReviewStatus(value: string | undefined): ModerationDetectionReviewStatus | undefined {
  return value === 'unreviewed' ||
    value === 'confirmed' ||
    value === 'false_positive' ||
    value === 'ignored'
    ? value
    : undefined;
}
function parseDiscordId(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? normalized : undefined;
}
function parseDate(value: string | undefined, endExclusive: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  return endExclusive ? new Date(date.getTime() + 86400000) : date;
}
function buildPageHref(guildId: string, query: SearchParams, page: number) {
  const params = new URLSearchParams();
  for (const key of ['kind', 'status', 'userId', 'channelId', 'from', 'to']) {
    const value = first(query[key]);
    if (value) params.set(key, value);
  }
  params.set('page', String(page));
  return `/dashboard/guilds/${guildId}/moderation/detections?${params.toString()}`;
}
function kindLabel(kind: ModerationDetectionKind) {
  return {
    word_exact: '完全一致ワード',
    word_contains: '部分一致ワード',
    word_regex: '正規表現ワード',
    invite_link: '招待リンク',
    mention_burst: '大量メンション',
    message_burst: '連投',
    duplicate_message: '重複投稿',
  }[kind];
}
function statusLabel(status: ModerationDetectionReviewStatus) {
  return { unreviewed: '未確認', confirmed: '正検知', false_positive: '誤検知', ignored: '無視' }[
    status
  ];
}
function statusClassName(status: ModerationDetectionReviewStatus) {
  const base = 'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium';
  if (status === 'confirmed') return `${base} border-emerald-500/30 text-emerald-600`;
  if (status === 'false_positive') return `${base} border-amber-500/30 text-amber-600`;
  if (status === 'ignored') return `${base} border-border text-muted`;
  return `${base} border-primary/30 text-primary`;
}
function formatDate(value: Date) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}
