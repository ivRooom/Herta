'use client';

import { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  Medal,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import { DiscordUserPicker } from './discord-user-picker';
import type {
  AchievementCatalogItem,
  AchievementOperationsSnapshot,
  AchievementUserProgress,
} from '@/lib/achievement-operations';

type OperationsPayload = {
  error?: string;
  snapshot?: AchievementOperationsSnapshot;
  catalog?: AchievementCatalogItem[];
  progress?: AchievementUserProgress | null;
  pluginEnabled?: boolean;
};

type OperationResponse = {
  error?: string;
  progress?: AchievementUserProgress;
};

type StatusFilter = 'all' | 'unlocked' | 'locked' | 'blocked';

export function AchievementOperationsDashboard({
  guildId,
  initialSnapshot,
  initialCatalog,
  pluginEnabled,
}: {
  guildId: string;
  initialSnapshot: AchievementOperationsSnapshot;
  initialCatalog: AchievementCatalogItem[];
  pluginEnabled: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AchievementUserProgress | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [reason, setReason] = useState('');

  const unlockedSet = useMemo(() => new Set(progress?.unlockedIds ?? []), [progress]);
  const blockedSet = useMemo(() => new Set(progress?.blockedIds ?? []), [progress]);
  const categories = useMemo(
    () =>
      Array.from(new Set(catalog.map((item) => item.category))).sort((a, b) => a.localeCompare(b)),
    [catalog],
  );
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja');
    return catalog.filter((item) => {
      const unlocked = unlockedSet.has(item.id);
      const blocked = blockedSet.has(item.id);
      if (statusFilter === 'unlocked' && !unlocked) return false;
      if (statusFilter === 'locked' && (unlocked || blocked)) return false;
      if (statusFilter === 'blocked' && !blocked) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!query) return true;
      return (
        item.name.toLocaleLowerCase('ja').includes(query) ||
        item.id.toLocaleLowerCase('ja').includes(query) ||
        item.category.toLocaleLowerCase('ja').includes(query)
      );
    });
  }, [blockedSet, catalog, categoryFilter, search, statusFilter, unlockedSet]);

  async function selectUser(value: string | string[] | null) {
    const userId = typeof value === 'string' ? value : null;
    setSelectedUserId(userId);
    setProgress(null);
    setStatus('');
    if (!userId) return;
    await refresh(userId, true);
  }

  async function refresh(userId = selectedUserId, showLoading = false) {
    if (showLoading) setLoadingUser(true);
    try {
      const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      const response = await fetch(`/api/guilds/${guildId}/achievements/operations${params}`, {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as OperationsPayload | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Achievement情報を取得できませんでした');
      if (payload?.snapshot) setSnapshot(payload.snapshot);
      if (payload?.catalog) setCatalog(payload.catalog);
      if (userId) setProgress(payload?.progress ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '再読み込みに失敗しました');
    } finally {
      if (showLoading) setLoadingUser(false);
    }
  }

  async function operate(item: AchievementCatalogItem, action: 'grant' | 'revoke') {
    if (!selectedUserId) return;
    if (action === 'revoke') {
      const confirmed = window.confirm(
        `${item.name} を取消し、自動同期でも再解除されない状態にします。実行しますか？`,
      );
      if (!confirmed) return;
    }
    setOperatingId(item.id);
    setStatus(action === 'grant' ? 'Achievementを付与中…' : 'Achievementを取消中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/achievements/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          userId: selectedUserId,
          achievementId: item.id,
          reason: reason.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as OperationResponse | null;
      if (!response.ok) throw new Error(payload?.error ?? 'Achievement操作に失敗しました');
      if (payload?.progress) setProgress(payload.progress);
      setStatus(
        action === 'grant'
          ? `${item.name} を手動付与しました。取消抑止があった場合は解除しました。`
          : `${item.name} を取消しました。自動同期による再解除も抑止されます。`,
      );
      await refresh(selectedUserId, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Achievement操作に失敗しました');
    } finally {
      setOperatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!pluginEnabled ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          Achievements
          Pluginは現在無効です。運用データの確認と手動操作はできますが、自動解除・通知はPluginを有効化するまで実行されません。
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={Trophy}
          label="Achievement"
          value={snapshot.totalCatalog.toLocaleString()}
        />
        <StatCard icon={Medal} label="総解除数" value={snapshot.totalUnlocks.toLocaleString()} />
        <StatCard
          icon={Users}
          label="解除メンバー"
          value={snapshot.uniqueMembers.toLocaleString()}
        />
        <StatCard icon={Clock3} label="直近7日" value={snapshot.unlocks7d.toLocaleString()} />
        <StatCard
          icon={Ban}
          label="手動取消中"
          value={snapshot.blockedOverrides.toLocaleString()}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">最近解除されたAchievement</h2>
              <p className="mt-1 text-xs text-muted">直近12件の解除履歴</p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-border p-2 text-muted transition hover:bg-background hover:text-foreground"
              aria-label="再読み込み"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {snapshot.recentUnlocks.length === 0 ? (
              <Empty text="まだ解除履歴がありません" />
            ) : (
              snapshot.recentUnlocks.map((item, index) => (
                <div
                  key={`${item.userId}-${item.id}-${item.unlockedAt}-${index}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                >
                  <span className="text-xl">{item.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="truncate text-xs text-muted">
                      &lt;@{item.userId}&gt; · {item.rarity} · {item.points.toLocaleString()}pt
                    </p>
                  </div>
                  <time className="shrink-0 text-[11px] text-muted">
                    {formatDate(item.unlockedAt)}
                  </time>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div>
            <h2 className="font-semibold">Badge Leaderboard</h2>
            <p className="mt-1 text-xs text-muted">解除数順 Top 10</p>
          </div>
          <div className="mt-4 space-y-2">
            {snapshot.leaderboard.length === 0 ? (
              <Empty text="Leaderboardデータがありません" />
            ) : (
              snapshot.leaderboard.map((entry, index) => (
                <div
                  key={entry.userId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">&lt;@{entry.userId}&gt;</p>
                    <p className="text-xs text-muted">{entry.unlockCount} achievements</p>
                  </div>
                  <span className="text-sm font-semibold">{entry.points.toLocaleString()}pt</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Member Operations</h2>
            </div>
            <p className="mt-1 text-sm text-muted">
              メンバーを検索して進捗確認、手動付与、永続的な取消抑止を行います。すべてAudit
              Logへ記録されます。
            </p>
          </div>
          {progress ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>
                {progress.unlockedCount}/{progress.totalCatalog} unlocked
              </Badge>
              <Badge>{progress.progressPercent}%</Badge>
              <Badge>{progress.points.toLocaleString()}pt</Badge>
              {progress.blockedCount > 0 ? <Badge>{progress.blockedCount} blocked</Badge> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted">対象メンバー</label>
            <DiscordUserPicker
              guildId={guildId}
              value={selectedUserId}
              onChange={(value) => void selectUser(value)}
              includeBots={false}
              placeholder="ユーザー名・表示名・Discord IDで検索"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-muted">
              操作理由（任意・Audit Log記録）
            </label>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, 240))}
              placeholder="例: イベント報酬の補正"
              className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {loadingUser ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> メンバー進捗を読み込み中…
          </div>
        ) : null}

        {selectedUserId && progress && !loadingUser ? (
          <>
            <div className="mt-5 flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Achievement名・ID・カテゴリで検索"
                  className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              >
                <option value="all">全ステータス</option>
                <option value="unlocked">解除済み</option>
                <option value="locked">未解除</option>
                <option value="blocked">手動取消中</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              >
                <option value="all">全カテゴリ</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredCatalog.map((item) => {
                const unlocked = unlockedSet.has(item.id);
                const blocked = blockedSet.has(item.id);
                const busy = operatingId === item.id;
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-border bg-background p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{item.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                          {item.id}
                        </p>
                      </div>
                      {blocked ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive">
                          BLOCKED
                        </span>
                      ) : unlocked ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
                      <Badge>{item.category}</Badge>
                      <Badge>{item.rarity}</Badge>
                      <Badge>{item.points.toLocaleString()}pt</Badge>
                      <Badge>{item.source}</Badge>
                    </div>
                    <div className="mt-4 flex gap-2">
                      {!unlocked ? (
                        <button
                          type="button"
                          disabled={busy || operatingId !== null}
                          onClick={() => void operate(item, 'grant')}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {blocked ? '抑止解除して付与' : '手動付与'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || operatingId !== null}
                          onClick={() => void operate(item, 'revoke')}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                          取消・再解除抑止
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {filteredCatalog.length === 0 ? (
              <div className="mt-4">
                <Empty text="条件に一致するAchievementがありません" />
              </div>
            ) : null}
          </>
        ) : null}

        {!selectedUserId ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border p-5 text-sm text-muted">
            <UserRound className="h-4 w-4" />{' '}
            対象メンバーを選択するとAchievement進捗と管理操作が表示されます。
          </div>
        ) : null}

        {status ? (
          <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted">
            {status}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Icon className="h-4 w-4 text-primary" /> {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-muted">
      {children}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
