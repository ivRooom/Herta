import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Mic,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';
import { auth } from '@/auth';
import { ReconnectNotice } from '@/components/reconnect-notice';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getDiscordAccessToken } from '@/lib/session';
import { prisma } from '@/lib/db';
import {
  listVcRecapSessionsForStudio,
  parseVcRecapQuery,
  type VcRecapParticipantDisplay,
  type VcRecapSessionDisplay,
} from '@/lib/vc-recap-studio';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: {
    label: '進行中',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  },
  summarizing: {
    label: '要約生成中',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  },
  failed: {
    label: '失敗',
    className: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
  },
  completed: {
    label: '完了',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  },
};

export default async function GuildVcRecapPage({
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
  const query = parseVcRecapQuery(toUrlSearchParams(rawSearchParams));
  let result: Awaited<ReturnType<typeof listVcRecapSessionsForStudio>> | null = null;
  try {
    result = await listVcRecapSessionsForStudio(prisma, guildId, query);
  } catch (error) {
    console.error('VC Recap dashboard request failed', error);
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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">VC Recap</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            VC通話終了時に生成された要約・トピックのみを表示します。発言の文字起こし本文は要約生成後に
            削除され、残りません。未同意メンバーの発言は録音・文字起こしの対象外です。
          </p>
        </div>
        {result ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-right shadow-card">
            <p className="text-xs text-muted">検索結果</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{result.total}件</p>
          </div>
        ) : null}
      </div>

      <FilterForm guildId={guildId} query={query} channelOptions={result?.channelOptions ?? []} />

      {!result ? (
        <section className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <h2 className="font-medium text-red-800 dark:text-red-200">
            VC Recapの履歴を取得できませんでした
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-red-800/80 dark:text-red-200/80">
            PostgreSQL接続とStudioログを確認してください。Guild設定やBotの動作には影響しません。
          </p>
        </section>
      ) : result.items.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <Mic className="mx-auto h-9 w-9 text-muted" aria-hidden="true" />
          <h2 className="mt-4 font-medium">条件に一致するVC Recapの記録はありません</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            検索条件を変更するか、`/vc-recap start`での記録後に再確認してください。
          </p>
        </section>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            {result.items.map((item) => (
              <VcRecapCard key={item.id} item={item} />
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
  channelOptions,
}: {
  guildId: string;
  query: ReturnType<typeof parseVcRecapQuery>;
  channelOptions: { id: string; name: string }[];
}) {
  return (
    <form
      method="get"
      action={`/dashboard/guilds/${guildId}/vc-recap`}
      className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-medium">絞り込み</h2>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">VC</span>
          <select
            name="channelId"
            defaultValue={query.channelId}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">すべてのVC</option>
            {channelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input type="hidden" name="pageSize" value={query.pageSize} />
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Link
          href={`/dashboard/guilds/${guildId}/vc-recap`}
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

function VcRecapCard({ item }: { item: VcRecapSessionDisplay }) {
  const status = STATUS_META[item.status] ?? {
    label: item.status,
    className: 'border-border bg-background text-muted',
  };

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted">
              <Mic className="h-3 w-3" aria-hidden="true" />
              {item.channelName}
            </span>
            <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed">
            {item.summary ?? '要約はまだありません。'}
          </p>
          {item.topics.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  {topic}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {formatDateTime(item.startedAt)}
          </span>
          {item.endedAt ? <span>〜 {formatDateTime(item.endedAt)}</span> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-2">
        <ParticipantGroup
          label="同意済み(文字起こし対象)"
          participants={item.consentingParticipants}
        />
        <ParticipantGroup
          label="未同意(文字起こし対象外)"
          participants={item.nonConsentingParticipants}
          muted
        />
      </div>
    </article>
  );
}

function ParticipantGroup({
  label,
  participants,
  muted,
}: {
  label: string;
  participants: VcRecapParticipantDisplay[];
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      {participants.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted">なし</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {participants.map((participant) => (
            <span
              key={participant.id}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                muted
                  ? 'border-border bg-background text-muted'
                  : 'border-border bg-surface font-medium'
              }`}
            >
              {participant.displayName}
            </span>
          ))}
        </div>
      )}
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
    <nav className="mt-6 flex items-center justify-between" aria-label="VC Recapのページ送り">
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
  return `/dashboard/guilds/${guildId}/vc-recap?${params.toString()}`;
}

function toUrlSearchParams(values: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }
  return params;
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(value);
}
