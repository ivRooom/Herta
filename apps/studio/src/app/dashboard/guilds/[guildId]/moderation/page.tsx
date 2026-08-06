import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import {
  listModerationCases,
  type ModerationCaseAction,
  type ModerationCaseRecord,
  type ModerationCaseStatus,
  type ModerationPrismaClient,
} from '@herta/plugin-catalog/moderation-service';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ModerationCasesPage({
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
    search: first(query.search),
    action: parseAction(first(query.action)),
    status: parseStatus(first(query.status)),
    targetUserId: parseDiscordId(first(query.targetUserId)),
    from: parseDate(first(query.from), false),
    toExclusive: parseDate(first(query.to), true),
  };

  let loadError: string | null = null;
  let result: Awaited<ReturnType<typeof listModerationCases>> = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
  try {
    result = await listModerationCases(prisma as unknown as ModerationPrismaClient, {
      guildId,
      ...filters,
    });
  } catch (error) {
    console.error('Moderation cases page failed to load', error);
    loadError = 'ケース一覧を取得できませんでした。時間をおいて再読み込みしてください。';
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
            <ShieldAlert className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">モデレーションケース</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {guild.name} の検知フラグ・警告・タイムアウト・Kick・BAN履歴を確認します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
            {plugin.enabled ? 'Plugin有効' : 'Plugin無効'}
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
            {result.total}件
          </span>
        </div>
      </div>

      <form className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="text-xs font-medium text-muted">ケース番号・対象ID・実行者ID・理由</span>
          <input
            name="search"
            defaultValue={filters.search}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="検索キーワード"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">対象ユーザーID</span>
          <input
            name="targetUserId"
            defaultValue={filters.targetUserId}
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="1234567890"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">種別</span>
          <select
            name="action"
            defaultValue={filters.action ?? ''}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="flag">検知フラグ</option>
            <option value="warn">警告</option>
            <option value="timeout">タイムアウト</option>
            <option value="kick">Kick</option>
            <option value="ban">BAN</option>
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">状態</span>
          <select
            name="status"
            defaultValue={filters.status ?? ''}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="active">有効</option>
            <option value="completed">完了</option>
            <option value="revoked">解除済み</option>
            <option value="failed">失敗</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-xs font-medium text-muted">開始日</span>
            <span className="mt-1 flex w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2">
              <input
                type="date"
                name="from"
                defaultValue={first(query.from)}
                className="block w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none"
              />
            </span>
          </label>
          <label>
            <span className="text-xs font-medium text-muted">終了日</span>
            <span className="mt-1 flex w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2">
              <input
                type="date"
                name="to"
                defaultValue={first(query.to)}
                className="block w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none"
              />
            </span>
          </label>
        </div>
        <div className="flex items-end gap-2 md:col-span-6 md:justify-end">
          <Link
            href={`/dashboard/guilds/${guildId}/moderation`}
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

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          {loadError}
        </div>
      ) : result.items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
          条件に一致するモデレーションケースはありません。
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-background/60 text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Case</th>
                  <th className="px-4 py-3 font-medium">種別 / 状態</th>
                  <th className="px-4 py-3 font-medium">対象ユーザー</th>
                  <th className="px-4 py-3 font-medium">理由</th>
                  <th className="px-4 py-3 font-medium">作成日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map((item) => (
                  <tr key={item.id} className="hover:bg-background/60">
                    <td className="px-4 py-4 font-medium">
                      <Link
                        href={`/dashboard/guilds/${guildId}/moderation/${item.caseNumber}`}
                        className="text-primary hover:underline"
                      >
                        #{item.caseNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <div>{actionLabel(item.action)}</div>
                      <div className="mt-1 text-xs text-muted">
                        {statusLabel(item.status)} · {sourceLabel(item.source)}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">{item.targetUserId}</td>
                    <td className="max-w-xs px-4 py-4 text-muted">
                      {item.reason ? truncate(item.reason, 100) : '理由なし'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-muted">
                      {new Intl.DateTimeFormat('ja-JP', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Tokyo',
                      }).format(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="ケースページング">
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
  for (const key of ['search', 'targetUserId', 'action', 'status', 'from', 'to']) {
    const value = first(query[key]);
    if (value) params.set(key, value);
  }
  params.set('page', String(page));
  return `/dashboard/guilds/${guildId}/moderation?${params.toString()}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAction(value: string | undefined): ModerationCaseAction | undefined {
  return value === 'warn' ||
    value === 'timeout' ||
    value === 'kick' ||
    value === 'ban' ||
    value === 'flag'
    ? value
    : undefined;
}

function parseStatus(value: string | undefined): ModerationCaseStatus | undefined {
  return value === 'active' || value === 'completed' || value === 'revoked' || value === 'failed'
    ? value
    : undefined;
}

function parseDiscordId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? normalized : undefined;
}

function parseDate(value: string | undefined, endExclusive: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const candidate = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(candidate.getTime())) return null;
  return endExclusive ? new Date(candidate.getTime() + 24 * 60 * 60 * 1000) : candidate;
}

function actionLabel(action: ModerationCaseAction): string {
  return {
    flag: '検知フラグ',
    warn: '警告',
    timeout: 'タイムアウト',
    kick: 'Kick',
    ban: 'BAN',
  }[action];
}

function statusLabel(status: ModerationCaseStatus): string {
  return { active: '有効', completed: '完了', revoked: '解除済み', failed: '失敗' }[status];
}

function sourceLabel(source: ModerationCaseRecord['source']): string {
  return { discord: 'Discord', dashboard: 'Herta Studio', automatic: '自動検知' }[source];
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
