import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MessageSquareReply,
  Timer,
} from 'lucide-react';
import {
  getAutoResponseStats,
  listAutoResponseRules,
  normalizeAutoResponseConfig,
  type AutoResponseMatchMode,
  type AutoResponsePrismaClient,
  type AutoResponseResponseType,
} from '@herta/plugin-catalog/auto-response-service';
import { auth } from '@/auth';
import {
  AutoResponseRuleManager,
  type AutoResponseRuleItem,
} from '@/components/auto-response-rule-manager';
import { prisma } from '@/lib/db';
import { getDiscordAccessToken } from '@/lib/session';
import { getManageableGuild, persistSelectedGuild } from '@/lib/guilds';
import { getGuildPlugin } from '@/lib/guild-plugins';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AutoResponsePage({
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

  const plugin = await getGuildPlugin(guildId, 'auto-response');
  if (!plugin) notFound();
  const config = normalizeAutoResponseConfig(plugin.config);
  const filters = {
    page: parsePositiveInteger(first(query.page)) ?? 1,
    pageSize: 20,
    search: first(query.search),
    matchMode: parseMatchMode(first(query.matchMode)),
    responseType: parseResponseType(first(query.responseType)),
    enabled: parseOptionalBoolean(first(query.enabled)),
  };

  let result: Awaited<ReturnType<typeof listAutoResponseRules>> = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
  let stats: Awaited<ReturnType<typeof getAutoResponseStats>> = {
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    averageDurationMs: 0,
  };
  let loadError: string | null = null;
  try {
    [result, stats] = await Promise.all([
      listAutoResponseRules(prisma as unknown as AutoResponsePrismaClient, {
        guildId,
        ...filters,
      }),
      getAutoResponseStats(prisma as unknown as AutoResponsePrismaClient, guildId),
    ]);
  } catch (error) {
    console.error('Auto Response page failed to load', error);
    loadError = '自動応答ルールを取得できませんでした。時間をおいて再読み込みしてください。';
  }

  const items: AutoResponseRuleItem[] = result.items.map((rule) => ({
    id: rule.id,
    name: rule.name,
    triggerValue: rule.triggerValue,
    matchMode: rule.matchMode,
    responseType: rule.responseType,
    responseContent: rule.responseContent,
    channelIds: rule.channelIds,
    roleIds: rule.roleIds,
    cooldownSeconds: rule.cooldownSeconds,
    priority: rule.priority,
    caseSensitive: rule.caseSensitive,
    enabled: rule.enabled,
    responseCount: rule.responseCount,
    failureCount: rule.failureCount,
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }));

  return (
    <div>
      <Link
        href={`/dashboard/guilds/${guildId}/plugins/auto-response`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Auto Response Pluginへ戻る
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareReply className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Auto Responseルール</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {guild.name} のトリガー、応答、Cooldown、対象範囲を管理します。
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted">
          {result.total} / {config.maxRules}件
        </span>
      </div>

      {!plugin.enabled ? (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Pluginは現在無効です。ルールは編集できますが、Discord上では実行されません。
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Activity className="h-5 w-5" />} label="成功" value={stats.successCount} />
        <Metric icon={<Activity className="h-5 w-5" />} label="失敗" value={stats.failureCount} />
        <Metric
          icon={<Timer className="h-5 w-5" />}
          label="Cooldown除外"
          value={stats.skippedCount}
        />
        <Metric
          icon={<Timer className="h-5 w-5" />}
          label="平均処理時間"
          value={`${stats.averageDurationMs} ms`}
        />
      </div>

      <form className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-4">
        <label className="md:col-span-2">
          <span className="text-xs font-medium text-muted">ルール名・トリガー</span>
          <input
            name="search"
            defaultValue={filters.search}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="検索キーワード"
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">一致方式</span>
          <select
            name="matchMode"
            defaultValue={filters.matchMode ?? ''}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="exact">完全一致</option>
            <option value="partial">部分一致</option>
            <option value="prefix">前方一致</option>
            <option value="regex">正規表現</option>
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">状態</span>
          <select
            name="enabled"
            defaultValue={filters.enabled === undefined ? '' : String(filters.enabled)}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">すべて</option>
            <option value="true">有効</option>
            <option value="false">無効</option>
          </select>
        </label>
        <div className="flex items-end justify-end gap-2 md:col-span-4">
          <Link
            href={`/dashboard/guilds/${guildId}/auto-response`}
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
      ) : (
        <div className="mt-6">
          <AutoResponseRuleManager
            guildId={guildId}
            initialRules={items}
            defaultRuleCooldownSeconds={config.defaultRuleCooldownSeconds}
          />
        </div>
      )}

      {result.totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="ルールページング">
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

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function buildPageHref(guildId: string, query: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const key of ['search', 'matchMode', 'responseType', 'enabled']) {
    const value = first(query[key]);
    if (value) params.set(key, value);
  }
  params.set('page', String(page));
  return `/dashboard/guilds/${guildId}/auto-response?${params.toString()}`;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMatchMode(value: string | undefined): AutoResponseMatchMode | undefined {
  return value === 'exact' || value === 'partial' || value === 'prefix' || value === 'regex'
    ? value
    : undefined;
}

function parseResponseType(value: string | undefined): AutoResponseResponseType | undefined {
  return value === 'text' || value === 'embed' ? value : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
