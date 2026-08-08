'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plus, RefreshCw, Search, Users, XCircle } from 'lucide-react';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { DiscordChannelPicker } from './discord-entity-picker';

export interface LfgPostItem {
  id: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  game: string;
  title: string;
  description: string;
  maxPlayers: number;
  participantCount: number;
  startTime: string | null;
  expiresAt: string;
  status: 'open' | 'full' | 'closed' | 'cancelled' | 'expired';
  messageState: string;
  lastErrorName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LfgParticipantItem {
  userId: string;
  status: string;
  joinedAt: string;
}

interface LfgDetailResponse {
  post: LfgPostItem;
  participants: LfgParticipantItem[];
}

interface CreateForm {
  channelId: string;
  game: string;
  title: string;
  description: string;
  maxPlayers: string;
  startTime: string;
  durationMinutes: string;
}

function createInitialForm(defaultMaxPlayers: number, defaultDurationMinutes: number): CreateForm {
  return {
    channelId: '',
    game: '',
    title: '',
    description: '',
    maxPlayers: String(defaultMaxPlayers),
    startTime: '',
    durationMinutes: String(defaultDurationMinutes),
  };
}

export function LfgManager({
  guildId,
  initialPosts,
  pluginEnabled,
  maxPlayersLimit,
  defaultMaxPlayers,
  defaultDurationMinutes,
  gamePresets,
  discordOptions,
}: {
  guildId: string;
  initialPosts: LfgPostItem[];
  pluginEnabled: boolean;
  maxPlayersLimit: number;
  defaultMaxPlayers: number;
  defaultDurationMinutes: number;
  gamePresets: string[];
  discordOptions?: GuildConfigurationOptions | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState<CreateForm>(() =>
    createInitialForm(defaultMaxPlayers, defaultDurationMinutes),
  );
  const [detail, setDetail] = useState<LfgDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeCount = useMemo(
    () => posts.filter((post) => post.status === 'open' || post.status === 'full').length,
    [posts],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (status) params.set('status', status);
      const response = await fetch(`/api/guilds/${guildId}/lfg/posts?${params.toString()}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as LfgPostItem[] | { error?: string };
      if (!response.ok) throw new Error(readError(body, '募集一覧の取得に失敗しました'));
      setPosts(body as LfgPostItem[]);
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function createPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const startTime = form.startTime ? new Date(form.startTime) : null;
      if (startTime && !Number.isFinite(startTime.getTime())) {
        throw new Error('開始日時が不正です');
      }
      const response = await fetch(`/api/guilds/${guildId}/lfg/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: form.channelId.trim(),
          game: form.game.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          maxPlayers: Number.parseInt(form.maxPlayers, 10),
          startTime: startTime?.toISOString() ?? null,
          durationMinutes: Number.parseInt(form.durationMinutes, 10),
        }),
      });
      const body = (await response.json()) as LfgPostItem | { error?: string };
      if (!response.ok) throw new Error(readError(body, '募集の作成に失敗しました'));
      setPosts((current) => [body as LfgPostItem, ...current]);
      setForm(createInitialForm(defaultMaxPlayers, defaultDurationMinutes));
      setNotice(
        pluginEnabled
          ? '募集を作成しました。WorkerがDiscordへ投稿します。'
          : '募集を作成しました。Plugin有効化後にDiscordへ投稿されます。',
      );
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(postId: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/lfg/posts/${postId}`, {
        cache: 'no-store',
      });
      const body = (await response.json()) as LfgDetailResponse | { error?: string };
      if (!response.ok) throw new Error(readError(body, '募集詳細の取得に失敗しました'));
      setDetail(body as LfgDetailResponse);
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function finalize(postId: string, action: 'close' | 'cancel') {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/lfg/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as LfgPostItem | { error?: string };
      if (!response.ok) throw new Error(readError(body, '募集の更新に失敗しました'));
      const updated = body as LfgPostItem;
      setPosts((current) => current.map((post) => (post.id === updated.id ? updated : post)));
      if (detail?.post.id === updated.id) setDetail({ ...detail, post: updated });
      setNotice(action === 'close' ? '募集を締め切りました。' : '募集をキャンセルしました。');
    } catch (caught) {
      setError(resolveErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">募集一覧</h2>
              <p className="mt-1 text-xs text-muted">
                募集中 {activeCount}件 / 表示 {posts.length}件
              </p>
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-elevated disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              再読み込み
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="タイトル・ゲーム・IDを検索"
                className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm"
              />
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            >
              <option value="">すべての状態</option>
              <option value="open">募集中</option>
              <option value="full">満員</option>
              <option value="closed">締切</option>
              <option value="cancelled">キャンセル</option>
              <option value="expired">期限切れ</option>
            </select>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              検索
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {posts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
                条件に一致する募集はありません。
              </div>
            ) : (
              posts.map((post) => (
                <article key={post.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={post.status} />
                        <span className="text-xs text-muted">{post.game}</span>
                      </div>
                      <h3 className="mt-2 truncate font-medium">{post.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">
                        {post.description || '説明なし'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted">
                      <Users className="h-4 w-4" /> {post.participantCount}/{post.maxPlayers}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                    <span>期限: {formatDate(post.expiresAt)}</span>
                    <span>Message: {post.messageState}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadDetail(post.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-elevated"
                    >
                      詳細
                    </button>
                    {post.status === 'open' || post.status === 'full' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void finalize(post.id, 'close')}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-elevated"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> 強制close
                        </button>
                        <button
                          type="button"
                          onClick={() => void finalize(post.id, 'cancel')}
                          className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5"
                        >
                          <XCircle className="h-3.5 w-3.5" /> 強制cancel
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        {detail ? (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{detail.post.title}</h2>
                <p className="mt-1 break-all text-xs text-muted">{detail.post.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-sm text-muted hover:text-foreground"
              >
                閉じる
              </button>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="作成者" value={detail.post.creatorId} />
              <Detail
                label="チャンネル"
                value={formatChannelLabel(detail.post.channelId, discordOptions)}
              />
              <Detail label="状態" value={detail.post.status} />
              <Detail label="メッセージ" value={detail.post.messageId ?? '未投稿'} />
              <Detail
                label="開始予定"
                value={detail.post.startTime ? formatDate(detail.post.startTime) : '未指定'}
              />
              <Detail label="募集期限" value={formatDate(detail.post.expiresAt)} />
            </dl>
            <div className="mt-5">
              <h3 className="text-sm font-medium">参加者</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.participants.map((participant) => (
                  <span
                    key={participant.userId}
                    className="rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    {participant.userId}
                  </span>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="rounded-2xl border border-border bg-surface p-5 shadow-card xl:sticky xl:top-6 xl:self-start">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Studioから募集作成</h2>
        </div>
        <p className="mt-2 text-xs text-muted">
          作成後、Workerが対象DiscordチャンネルへButton付きメッセージを投稿します。
        </p>
        <form className="mt-5 space-y-3" onSubmit={(event) => void createPost(event)}>
          <Field label="投稿チャンネル">
            <DiscordChannelPicker
              options={discordOptions?.channels ?? []}
              value={form.channelId || null}
              placeholder="募集を投稿するチャンネルを検索"
              onChange={(next) =>
                setForm({
                  ...form,
                  channelId: Array.isArray(next) ? (next[0] ?? '') : (next ?? ''),
                })
              }
            />
          </Field>
          <Field label="ゲーム・イベント">
            <input
              list="lfg-game-presets"
              required
              value={form.game}
              onChange={(event) => setForm({ ...form, game: event.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              placeholder="ゲーム名またはイベント名"
              autoComplete="off"
            />
            <datalist id="lfg-game-presets">
              {gamePresets.map((game) => (
                <option key={game} value={game} />
              ))}
            </datalist>
          </Field>
          <Field label="タイトル">
            <input
              required
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
          </Field>
          <Field label="説明">
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="min-h-24 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="定員">
              <input
                type="number"
                min={2}
                max={maxPlayersLimit}
                required
                value={form.maxPlayers}
                onChange={(event) => setForm({ ...form, maxPlayers: event.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </Field>
            <Field label="募集期間（分）">
              <input
                type="number"
                min={5}
                required
                value={form.durationMinutes}
                onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
              />
            </Field>
          </div>
          <Field label="開始予定">
            <input
              type="datetime-local"
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
            />
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? '処理中…' : '募集を作成'}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            {notice}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function formatChannelLabel(
  channelId: string,
  discordOptions?: GuildConfigurationOptions | null,
): string {
  const channel = discordOptions?.channels.find((candidate) => candidate.id === channelId);
  return channel ? `#${channel.name}` : channelId;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-all">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: LfgPostItem['status'] }) {
  const label = {
    open: '募集中',
    full: '満員',
    closed: '締切',
    cancelled: 'キャンセル',
    expired: '期限切れ',
  }[status];
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
      {label}
    </span>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '処理に失敗しました';
}

function readError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error;
    if (typeof message === 'string') return message;
  }
  return fallback;
}
