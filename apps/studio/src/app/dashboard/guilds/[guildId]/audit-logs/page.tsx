import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { auth } from '@/auth';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { listGuildAuditLogs, parseAuditLogQuery, type AuditLogItem } from '@/lib/audit-logs';
import { prisma } from '@/lib/db';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const CATEGORY_LABELS = {
  plugin: 'Plugin',
  quote: 'Quote',
  other: 'その他',
} as const;

const SEVERITY_META: Record<string, { label: string; className: string }> = {
  info: {
    label: '情報',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  },
  warning: {
    label: '注意',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  },
  error: {
    label: 'エラー',
    className: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
  },
  critical: {
    label: '重大',
    className: 'border-red-700/40 bg-red-700/15 text-red-900 dark:text-red-100',
  },
};

export default async function GuildAuditLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { guildId } = await params;
  const session = await auth();
  const accessToken = await getDiscordAccessToken();

  if (!accessToken) {
    return (
      <div>
        <BackLink guildId={guildId} />
        <div className="mt-6">
          <ReconnectNotice />
        </div>
      </div>
    );
  }

  const guild = await getManageableGuild(accessToken, guildId);
  if (!guild || !session?.user) notFound();
  await persistSelectedGuild(guild, session.user.id);

  const rawSearchParams = await searchParams;
  const query = parseAuditLogQuery(toUrlSearchParams(rawSearchParams));
  let result: Awaited<ReturnType<typeof listGuildAuditLogs>> | null = null;
  try {
    result = await listGuildAuditLogs(prisma, guildId, query);
  } catch (error) {
    console.error('Audit log dashboard request failed', error);
  }

  return (
    <div>
      <BackLink guildId={guildId} />

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {guild.name}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">監査ログ</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Plugin設定やQuote操作など、管理対象に対する変更履歴を確認できます。設定値、Quote本文、
            メッセージ本文などの内容は表示しません。
          </p>
        </div>
        {result ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-right shadow-card">
            <p className="text-xs text-muted">検索結果</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{result.total}件</p>
          </div>
        ) : null}
      </div>

      <FilterForm guildId={guildId} query={query} />

      {!result ? (
        <section className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <h2 className="font-medium text-red-800 dark:text-red-200">
            監査ログを取得できませんでした
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-red-800/80 dark:text-red-200/80">
            PostgreSQL接続とStudioログを確認してください。Guild設定やBotの動作には影響しません。
          </p>
        </section>
      ) : result.items.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <History className="mx-auto h-9 w-9 text-muted" aria-hidden="true" />
          <h2 className="mt-4 font-medium">条件に一致する監査ログはありません</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            検索条件を変更するか、Pluginの有効化・設定変更、Quote操作を行った後に再確認してください。
          </p>
        </section>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            {result.items.map((item) => (
              <AuditLogCard key={item.id} item={item} />
            ))}
          </div>
          <Pagination
            guildId={guildId}
            currentPage={result.page}
            totalPages={result.totalPages}
            searchParams={rawSearchParams}
          />
        </>
      )}
    </div>
  );
}

function FilterForm({
  guildId,
  query,
}: {
  guildId: string;
  query: ReturnType<typeof parseAuditLogQuery>;
}) {
  return (
    <form
      method="get"
      action={`/dashboard/guilds/${guildId}/audit-logs`}
      className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-medium">絞り込み</h2>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">検索</span>
          <span className="relative mt-1.5 block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
            <input
              name="search"
              defaultValue={query.search}
              maxLength={100}
              placeholder="イベント名・ユーザーID・対象ID"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
            />
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-muted">カテゴリ</span>
            <select
              name="category"
              defaultValue={query.category}
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">すべて</option>
              <option value="plugin">Plugin</option>
              <option value="quote">Quote</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">重要度</span>
            <select
              name="severity"
              defaultValue={query.severity}
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">すべて</option>
              <option value="info">情報</option>
              <option value="warning">注意</option>
              <option value="error">エラー</option>
              <option value="critical">重大</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">開始日（日本時間）</span>
          <input
            type="date"
            name="from"
            defaultValue={query.fromInput}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">終了日（日本時間）</span>
          <input
            type="date"
            name="to"
            defaultValue={query.toInput}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>
      <input type="hidden" name="pageSize" value={query.pageSize} />
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Link
          href={`/dashboard/guilds/${guildId}/audit-logs`}
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-background"
        >
          条件をクリア
        </Link>
        <button
          type="submit"
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          検索する
        </button>
      </div>
    </form>
  );
}

function AuditLogCard({ item }: { item: AuditLogItem }) {
  const severity = SEVERITY_META[item.severity] ?? {
    label: item.severity,
    className: 'border-border bg-background text-muted',
  };

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {CATEGORY_LABELS[item.category]}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${severity.className}`}
            >
              {severity.label}
            </span>
          </div>
          <h2 className="mt-3 font-medium">{item.eventLabel}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{item.summary}</p>
        </div>
        <time className="shrink-0 text-xs text-muted" dateTime={item.createdAt}>
          {formatDateTime(item.createdAt)}
        </time>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-3">
        <div className="flex min-w-0 items-start gap-2">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted">実行者</p>
            <p className="mt-0.5 truncate font-medium">{item.actorLabel}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted">対象</p>
            <p className="mt-0.5 truncate font-medium">{item.targetLabel}</p>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted">実行元</p>
            <p className="mt-0.5 truncate font-medium">{item.sourceLabel ?? '記録なし'}</p>
          </div>
        </div>
      </div>

      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          調査用IDを表示
        </summary>
        <dl className="mt-3 grid gap-2 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
          <Detail label="イベントコード" value={item.event} />
          <Detail label="実行者ID" value={item.actorId} />
          <Detail label="対象ID" value={item.targetId ?? 'なし'} />
          <Detail label="監査ログID" value={item.id} />
        </dl>
      </details>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-foreground">{value}</dd>
    </div>
  );
}

function Pagination({
  guildId,
  currentPage,
  totalPages,
  searchParams,
}: {
  guildId: string;
  currentPage: number;
  totalPages: number;
  searchParams: SearchParams;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="監査ログのページ送り">
      {currentPage > 1 ? (
        <Link
          href={buildPageHref(guildId, searchParams, currentPage - 1)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          前のページ
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted">
        {currentPage} / {totalPages}ページ
      </span>
      {currentPage < totalPages ? (
        <Link
          href={buildPageHref(guildId, searchParams, currentPage + 1)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40"
        >
          次のページ
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function BackLink({ guildId }: { guildId: string }) {
  return (
    <Link
      href={`/dashboard/guilds/${guildId}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      サーバー詳細へ戻る
    </Link>
  );
}

function buildPageHref(guildId: string, values: SearchParams, page: number): string {
  const params = toUrlSearchParams(values);
  params.set('page', String(page));
  return `/dashboard/guilds/${guildId}/audit-logs?${params.toString()}`;
}

function toUrlSearchParams(values: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  return params;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}
