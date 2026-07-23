import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { listQuotes, type QuotePrismaClient } from '@herta/plugin-catalog/quote-service';
import { auth } from '@/auth';
import { QuoteManager, type QuoteManagerItem } from '@/components/quote-manager';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function QuoteManagementPage({
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

  const plugin = await getGuildPlugin(guildId, 'quote');
  if (!plugin) notFound();

  const filters = {
    page: parsePositiveInteger(first(query.page)) ?? 1,
    pageSize: 20,
    search: first(query.search),
    tag: first(query.tag),
    status: first(query.status),
    isNsfw: parseOptionalBoolean(first(query.isNsfw)),
  };

  const result = await listQuotes(prisma as unknown as QuotePrismaClient, {
    guildId,
    ...filters,
  });
  const items: QuoteManagerItem[] = result.items.map((quote) => ({
    quoteNumber: quote.quoteNumber,
    quoteText: quote.quoteText,
    sourceAuthorName: quote.sourceAuthorName,
    registeredByName: quote.registeredByName,
    tags: quote.tags,
    status: quote.status,
    isNsfw: quote.isNsfw,
    createdAt: quote.createdAt.toISOString(),
  }));

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/quote`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Quote Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quote管理</h1>
          <p className="mt-2 text-sm text-muted">
            {guild.name} の名言を検索・登録・編集・削除します。
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
          {result.total}件
        </span>
      </div>

      <form className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-5">
        <label className="md:col-span-2">
          <span className="text-xs font-medium text-muted">番号・本文・作者</span>
          <input
            name="search"
            defaultValue={filters.search}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="検索キーワード"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">タグ</span>
          <input
            name="tag"
            defaultValue={filters.tag}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="herta"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">ステータス</span>
          <select
            name="status"
            defaultValue={filters.status ?? ''}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="public">public</option>
            <option value="private">private</option>
            <option value="hidden">hidden</option>
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">NSFW</span>
          <select
            name="isNsfw"
            defaultValue={filters.isNsfw === undefined ? '' : String(filters.isNsfw)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="false">通常</option>
            <option value="true">NSFW</option>
          </select>
        </label>
        <div className="flex items-end gap-2 md:col-span-5 md:justify-end">
          <Link
            href={`/dashboard/guilds/${guildId}/plugins/quote/quotes`}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-background"
          >
            リセット
          </Link>
          <button
            type="submit"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            検索
          </button>
        </div>
      </form>

      <div className="mt-6">
        <QuoteManager guildId={guildId} items={items} />
      </div>

      {result.totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Quoteページング">
          {result.page > 1 ? (
            <Link
              href={buildPageHref(guildId, query, result.page - 1)}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface"
            >
              <ChevronLeft className="h-4 w-4" /> 前へ
            </Link>
          ) : null}
          <span className="text-sm text-muted">
            {result.page} / {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link
              href={buildPageHref(guildId, query, result.page + 1)}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface"
            >
              次へ <ChevronRight className="h-4 w-4" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function buildPageHref(guildId: string, query: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const key of ['search', 'tag', 'status', 'isNsfw']) {
    const value = first(query[key]);
    if (value) params.set(key, value);
  }
  params.set('page', String(page));
  return `/dashboard/guilds/${guildId}/plugins/quote/quotes?${params.toString()}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
