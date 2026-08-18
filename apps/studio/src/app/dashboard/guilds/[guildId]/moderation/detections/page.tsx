import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Pencil,
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
import {
  legacyRuleReference,
  listCurrentModerationWordRuleGroups,
  resolveModerationDetectionRuleSnapshots,
} from '@/lib/moderation-detection-rules';
import { toModerationConfigDraft } from '@/lib/moderation-config-ui';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
type DetectionItem = Awaited<ReturnType<typeof listModerationDetections>>['items'][number];

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
  const moderationConfig = toModerationConfigDraft(plugin.config);
  const currentWordRuleGroups = listCurrentModerationWordRuleGroups(plugin.config);
  const currentWordRuleCount = currentWordRuleGroups.reduce(
    (sum, group) => sum + group.values.length,
    0,
  );

  const filters = {
    page: parsePositiveInteger(first(query.page)) ?? 1,
    pageSize: 20,
    detectionId: parseUuid(first(query.detectionId)),
    detectionKind: parseDetectionKind(first(query.kind)),
    reviewStatus: parseReviewStatus(first(query.status)),
    userId: parseDiscordId(first(query.userId)),
    channelId: parseDiscordId(first(query.channelId)),
    from: parseDate(first(query.from), false),
    toExclusive: parseDate(first(query.to), true),
  };
  const hasAdvancedFilters = Boolean(
    filters.userId || filters.channelId || first(query.from) || first(query.to),
  );

  let loadError: string | null = null;
  let result: Awaited<ReturnType<typeof listModerationDetections>> = EMPTY_RESULT;
  let stats: Awaited<ReturnType<typeof getModerationDetectionStats>> = EMPTY_STATS;
  let ruleSnapshots = new Map<string, string>();
  try {
    [result, stats] = await Promise.all([
      listModerationDetections(prisma as unknown as ModerationPrismaClient, {
        guildId,
        ...filters,
      }),
      getModerationDetectionStats(prisma as unknown as ModerationPrismaClient, {
        guildId,
        detectionId: filters.detectionId,
        detectionKind: filters.detectionKind,
        reviewStatus: filters.reviewStatus,
        userId: filters.userId,
        channelId: filters.channelId,
        from: filters.from,
        toExclusive: filters.toExclusive,
      }),
    ]);
    ruleSnapshots = await resolveModerationDetectionRuleSnapshots(prisma, guildId, result.items);
  } catch (error) {
    console.error('Moderation detections page failed to load', error);
    loadError = '自動検知履歴を取得できませんでした。DB接続と設定履歴を確認してください。';
  }

  return (
    <div className="min-w-0">
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/moderation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Moderation Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radar className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">自動検知レビュー</h1>
          </div>
          <p className="mt-2 break-words text-sm text-muted">
            {guild.name} の自動検知を、検知したルールを確認しながらレビューします。
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Link
            href={`/dashboard/guilds/${guildId}/moderation`}
            className="rounded-xl border border-border px-3 py-2 text-center text-sm font-medium hover:bg-surface sm:px-4"
          >
            ケース履歴
          </Link>
          <span className="rounded-xl bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground sm:px-4">
            自動検知
          </span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-muted">
        Discordメッセージ本文・一致箇所・招待コードは保存していません。NGワード系の検知根拠は、検知時点より前のModeration設定履歴から管理者が登録したルールだけを復元して表示します。
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ListFilter className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-semibold">現在監視しているNGワード</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">
              部分一致は通常のBad Word向けです。完全一致・正規表現もGuildごとに追加できます。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                plugin.enabled && moderationConfig.automaticMode === 'observe'
                  ? 'border-emerald-500/30 text-emerald-600'
                  : 'border-amber-500/30 text-amber-600'
              }`}
            >
              {plugin.enabled && moderationConfig.automaticMode === 'observe'
                ? '自動検知 ON'
                : '自動検知 OFF'}
            </span>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">
              {currentWordRuleCount}件
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {currentWordRuleGroups.map((group) => (
            <details
              key={group.kind}
              open={group.kind === 'word_contains' && group.values.length > 0}
              className="rounded-xl border border-border bg-background p-4"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                    {group.values.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{group.description}</p>
              </summary>
              {group.values.length > 0 ? (
                <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-border pt-3">
                  {group.values.map((value, index) => (
                    <div
                      key={`${group.kind}:${index}:${value}`}
                      className="break-all rounded-lg bg-surface px-2.5 py-2 font-mono text-xs"
                    >
                      {value}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted">登録なし</p>
              )}
            </details>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted">
            追加・編集・削除は既存のModeration設定「検知ルール」から行い、保存するとBot Runtimeへ反映されます。
          </p>
          <Link
            href={`/dashboard/guilds/${guildId}/plugins/moderation`}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" /> NGワードを追加・編集
          </Link>
        </div>
      </section>

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

      <form className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <FilterSelect name="kind" label="検知種別" defaultValue={filters.detectionKind ?? ''}>
            <option value="">すべて</option>
            {DETECTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            name="status"
            label="レビュー状態"
            defaultValue={filters.reviewStatus ?? ''}
          >
            <option value="">すべて</option>
            <option value="unreviewed">未確認</option>
            <option value="confirmed">正検知</option>
            <option value="false_positive">誤検知</option>
            <option value="ignored">無視</option>
          </FilterSelect>

          <details open={hasAdvancedFilters} className="group sm:col-span-2 lg:col-span-4">
            <summary className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium lg:hidden">
              詳細条件
            </summary>
            <div className="mt-3 hidden gap-3 group-open:grid sm:grid-cols-2 lg:mt-0 lg:!grid lg:grid-cols-4">
              <FilterInput name="userId" label="ユーザーID" defaultValue={filters.userId} />
              <FilterInput name="channelId" label="チャンネルID" defaultValue={filters.channelId} />
              <FilterInput
                name="from"
                label="開始日"
                defaultValue={first(query.from)}
                type="date"
              />
              <FilterInput name="to" label="終了日" defaultValue={first(query.to)} type="date" />
            </div>
          </details>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Link
            href={`/dashboard/guilds/${guildId}/moderation/detections`}
            className="rounded-xl border border-border px-4 py-2 text-center text-sm font-medium hover:bg-background"
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
        <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted sm:p-10">
          条件に一致する自動検知履歴はありません。
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-3 md:hidden">
            {result.items.map((item) => (
              <DetectionMobileCard
                key={item.id}
                guildId={guildId}
                item={item}
                ruleSnapshot={ruleSnapshots.get(item.id)}
              />
            ))}
          </div>

          <div className="mt-6 hidden overflow-hidden rounded-2xl border border-border bg-surface shadow-card md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-background/60 text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">日時 / 種別</th>
                    <th className="px-4 py-3 font-medium">対象</th>
                    <th className="px-4 py-3 font-medium">検知根拠</th>
                    <th className="px-4 py-3 font-medium">状態</th>
                    <th className="px-4 py-3 font-medium">レビュー</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((item) => (
                    <tr
                      id={`detection-${item.id}`}
                      key={item.id}
                      className="align-top hover:bg-background/60"
                    >
                      <td className="px-4 py-4">
                        <div className="font-medium">{kindLabel(item.detectionKind)}</div>
                        <div className="mt-1 whitespace-nowrap text-xs text-muted">
                          {formatDate(item.occurredAt)}
                        </div>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs">
                        <div className="whitespace-nowrap">User: {item.userId}</div>
                        <div className="mt-1 whitespace-nowrap text-muted">
                          Channel: {item.channelId}
                        </div>
                        <div className="mt-1 whitespace-nowrap text-muted">
                          Message: {item.messageId}
                        </div>
                      </td>
                      <td className="max-w-xs px-4 py-4 text-muted">
                        <DetectionEvidence
                          item={item}
                          ruleSnapshot={ruleSnapshots.get(item.id)}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <span className={statusClassName(item.reviewStatus)}>
                          {statusLabel(item.reviewStatus)}
                        </span>
                        {item.reviewedAt ? (
                          <div className="mt-2 whitespace-nowrap text-xs text-muted">
                            {formatDate(item.reviewedAt)}
                          </div>
                        ) : null}
                      </td>
                      <td className="w-64 px-4 py-4">
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
        </>
      )}

      {result.totalPages > 1 ? (
        <nav
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
          aria-label="検知履歴ページング"
        >
          {result.page > 1 ? (
            <Link href={buildPageHref(guildId, query, result.page - 1)} className={PAGE_LINK}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> 前へ
            </Link>
          ) : null}
          <span className="text-sm text-muted">
            {result.page} / {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link href={buildPageHref(guildId, query, result.page + 1)} className={PAGE_LINK}>
              次へ <ChevronRight className="h-4 w-4" aria-hidden="true" />
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

function DetectionMobileCard({
  guildId,
  item,
  ruleSnapshot,
}: {
  guildId: string;
  item: DetectionItem;
  ruleSnapshot?: string;
}) {
  return (
    <article
      id={`detection-${item.id}`}
      className="min-w-0 scroll-mt-20 rounded-2xl border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{kindLabel(item.detectionKind)}</h2>
          <p className="mt-1 text-xs text-muted">{formatDate(item.occurredAt)}</p>
        </div>
        <span className={`${statusClassName(item.reviewStatus)} shrink-0`}>
          {statusLabel(item.reviewStatus)}
        </span>
      </div>

      <dl className="mt-4 space-y-3 text-xs">
        <IdRow label="User ID" value={item.userId} />
        <IdRow label="Channel ID" value={item.channelId} />
        <IdRow label="Message ID" value={item.messageId} />
      </dl>

      <div className="mt-4 rounded-xl bg-background p-3 text-xs">
        <DetectionEvidence item={item} ruleSnapshot={ruleSnapshot} />
      </div>

      {item.reviewedAt ? (
        <p className="mt-3 text-xs text-muted">最終レビュー: {formatDate(item.reviewedAt)}</p>
      ) : null}

      <div className="mt-4">
        <ModerationDetectionReview
          guildId={guildId}
          detectionId={item.id}
          initialStatus={item.reviewStatus}
          initialNote={item.reviewNote}
          showQuickActions
        />
      </div>
    </article>
  );
}

function DetectionEvidence({
  item,
  ruleSnapshot,
}: {
  item: DetectionItem;
  ruleSnapshot?: string;
}) {
  const legacyRule = legacyRuleReference(item.ruleIndex);
  const isWordRule =
    item.detectionKind === 'word_exact' ||
    item.detectionKind === 'word_contains' ||
    item.detectionKind === 'word_regex';

  return (
    <div className="space-y-2">
      {isWordRule ? (
        <div>
          <div className="text-xs font-medium text-foreground">検知ルール</div>
          {ruleSnapshot ? (
            <code className="mt-1 block break-all rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs text-foreground">
              {ruleSnapshot}
            </code>
          ) : (
            <div className="mt-1 text-xs text-amber-600">
              {legacyRule ?? '当時のルール設定を特定できません'}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="text-xs font-medium text-foreground">組み込み検知</div>
          <div className="mt-1 text-xs leading-5">{builtInEvidenceLabel(item.detectionKind)}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs">
        <Metric label="本文長" value={item.messageLength} />
        <Metric
          label="観測 / 閾値"
          value={`${item.observedCount ?? '—'} / ${item.threshold ?? '—'}`}
        />
      </div>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-foreground">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-muted">{label}</div>
      <div className="mt-1 break-words font-medium text-foreground">{value}</div>
    </div>
  );
}

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
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon className="h-4 w-4" aria-hidden="true" /> {label}
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
    <label className="min-w-0">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        inputMode={type === 'text' ? 'numeric' : undefined}
        className="mt-1 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
    <label className="min-w-0">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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

function parseUuid(value: string | undefined) {
  const normalized = value?.trim();
  return normalized &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
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
  for (const key of ['detectionId', 'kind', 'status', 'userId', 'channelId', 'from', 'to']) {
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

function builtInEvidenceLabel(kind: ModerationDetectionKind) {
  return {
    word_exact: 'カスタム完全一致ルール',
    word_contains: 'カスタム部分一致ルール',
    word_regex: 'カスタム正規表現ルール',
    invite_link: '許可リストにないDiscord招待リンク',
    mention_burst: '1メッセージ内の大量メンション',
    message_burst: '指定時間内の連続投稿',
    duplicate_message: '指定時間内の同一内容の繰り返し投稿',
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
