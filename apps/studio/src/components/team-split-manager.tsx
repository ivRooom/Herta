'use client';

import { FormEvent, useCallback, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Shuffle, UserMinus, UserPlus } from 'lucide-react';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { DiscordChannelPicker } from './discord-entity-picker';
import { DiscordUserPicker } from './discord-user-picker';

export interface TeamSplitSessionItem {
  id: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  teamCount: number;
  mode: 'random' | 'balanced';
  maxParticipants: number;
  participantCount: number;
  generation: number;
  status: 'open' | 'split' | 'closed' | 'expired';
  expiresAt: string;
  splitAt: string | null;
  closedAt: string | null;
  messageState: string;
  lastErrorName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ParticipantItem {
  userId: string;
  score: number;
  status: string;
  joinedAt: string;
}

interface TeamMember {
  userId: string;
  score: number;
}

interface TeamResult {
  teamNumber: number;
  members: TeamMember[];
  totalScore: number;
}

interface SessionDetail {
  session: TeamSplitSessionItem & { teams?: unknown };
  participants: ParticipantItem[];
}

interface Props {
  guildId: string;
  initialSessions: TeamSplitSessionItem[];
  pluginEnabled: boolean;
  maxParticipantsLimit: number;
  maxTeamCount: number;
  discordOptions?: GuildConfigurationOptions | null;
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary';

export function TeamSplitManager({
  guildId,
  initialSessions,
  pluginEnabled,
  maxParticipantsLimit,
  maxTeamCount,
  discordOptions,
}: Props) {
  const [sessions, setSessions] = useState(initialSessions);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'random' | 'balanced'>('random');
  const [teamCount, setTeamCount] = useState(2);
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [seed, setSeed] = useState('');
  const [creatorScore, setCreatorScore] = useState(0);
  const [participantUserId, setParticipantUserId] = useState('');
  const [participantScore, setParticipantScore] = useState(0);

  const visibleSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return sessions.filter(
      (item) =>
        (!status || item.status === status) &&
        (!normalized ||
          item.title.toLocaleLowerCase('ja').includes(normalized) ||
          item.id.toLocaleLowerCase('ja').includes(normalized)),
    );
  }, [query, sessions, status]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (status) params.set('status', status);
      const response = await fetch(
        `/api/guilds/${guildId}/team-split/sessions?${params.toString()}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(await readResponseError(response));
      const body = await response.json();
      setSessions(body as TeamSplitSessionItem[]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }, [guildId, query, status]);

  const loadDetail = useCallback(
    async (sessionId: string) => {
      setSelectedId(sessionId);
      setDetailLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/guilds/${guildId}/team-split/sessions/${sessionId}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(await readResponseError(response));
        const body = await response.json();
        setDetail(body as SessionDetail);
      } catch (requestError) {
        setError(readError(requestError));
      } finally {
        setDetailLoading(false);
      }
    },
    [guildId],
  );

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/team-split/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          title,
          mode,
          teamCount,
          maxParticipants,
          durationMinutes,
          seed: seed || null,
          creatorScore: mode === 'balanced' ? creatorScore : 0,
        }),
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      const body = await response.json();
      const created = normalizeSession(body);
      setSessions((current) => [created, ...current]);
      setTitle('');
      setSeed('');
      setNotice('Team Splitセッションを作成しました。WorkerがDiscordメッセージを投稿します。');
      await loadDetail(created.id);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: 'split' | 'reroll' | 'close') {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await patchSession(selectedId, { action });
      setNotice(
        action === 'split'
          ? 'チーム分けを実行しました。'
          : action === 'reroll'
            ? 'チームを再抽選しました。'
            : 'セッションを終了しました。',
      );
      await Promise.all([loadSessions(), loadDetail(selectedId)]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !participantUserId) return;
    setLoading(true);
    setError(null);
    try {
      await patchSession(selectedId, {
        action: 'add',
        userId: participantUserId,
        score: participantScore,
      });
      setParticipantUserId('');
      setParticipantScore(0);
      setNotice('参加者を追加またはscore更新しました。');
      await Promise.all([loadSessions(), loadDetail(selectedId)]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function removeParticipant(userId: string) {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      await patchSession(selectedId, { action: 'remove', userId });
      setNotice('参加者を削除しました。');
      await Promise.all([loadSessions(), loadDetail(selectedId)]);
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function patchSession(sessionId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/guilds/${guildId}/team-split/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readResponseError(response));
    const payload = await response.json();
    return payload;
  }

  const teams = readTeams(detail?.session.teams);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
      <div className="space-y-6">
        <form
          onSubmit={createSession}
          className="rounded-2xl border border-border bg-surface p-5 shadow-card"
        >
          <div className="flex items-center gap-2">
            <Shuffle className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">新しいセッション</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="text-sm">
              <span className="mb-1.5 block text-muted">投稿チャンネル</span>
              <DiscordChannelPicker
                options={discordOptions?.channels ?? []}
                value={channelId || null}
                placeholder="参加募集を投稿するチャンネルを検索"
                onChange={(next) =>
                  setChannelId(Array.isArray(next) ? (next[0] ?? '') : (next ?? ''))
                }
              />
            </div>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted">タイトル</span>
              <input
                className={inputClass}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </label>
            <div className="text-sm md:col-span-2">
              <span className="mb-1.5 block text-muted">チーム分け方式</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <ModeCard
                  active={mode === 'random'}
                  title="ランダム"
                  description="参加者をランダムに割り当てます。気軽な募集向けです。"
                  onClick={() => setMode('random')}
                />
                <ModeCard
                  active={mode === 'balanced'}
                  title="バランス"
                  description="各参加者のscoreを使い、チーム合計値が近くなるように分けます。"
                  onClick={() => setMode('balanced')}
                />
              </div>
            </div>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted">チーム数</span>
              <input
                className={inputClass}
                type="number"
                min={2}
                max={maxTeamCount}
                value={teamCount}
                onChange={(event) => setTeamCount(Number(event.target.value))}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted">最大参加人数</span>
              <input
                className={inputClass}
                type="number"
                min={teamCount}
                max={maxParticipantsLimit}
                value={maxParticipants}
                onChange={(event) => setMaxParticipants(Number(event.target.value))}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted">受付期間（分）</span>
              <input
                className={inputClass}
                type="number"
                min={5}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1.5 block text-muted">任意seed</span>
              <input
                className={inputClass}
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                maxLength={128}
                placeholder="公開表示されません"
              />
            </label>
            {mode === 'balanced' ? (
              <label className="text-sm">
                <span className="mb-1.5 block text-muted">作成者score</span>
                <input
                  className={inputClass}
                  type="number"
                  min={-100000}
                  max={100000}
                  value={creatorScore}
                  onChange={(event) => setCreatorScore(Number(event.target.value))}
                />
              </label>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={!pluginEnabled || loading}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Shuffle className="h-4 w-4" />
            )}
            セッション作成
          </button>
        </form>

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className={`${inputClass} min-w-56 flex-1`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="タイトルまたはIDで検索"
            />
            <select
              className={`${inputClass} w-auto`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全状態</option>
              <option value="open">受付中</option>
              <option value="split">分割済み</option>
              <option value="closed">終了</option>
              <option value="expired">期限切れ</option>
            </select>
            <button
              type="button"
              onClick={() => void loadSessions()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-muted/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 更新
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {visibleSessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                条件に一致するセッションはありません。
              </p>
            ) : (
              visibleSessions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadDetail(item.id)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selectedId === item.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.title}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{item.mode}</span>
                    <span>{item.teamCount}チーム</span>
                    <span>
                      {item.participantCount}/{item.maxParticipants}人
                    </span>
                    <span>generation {item.generation}</span>
                    <span>message: {item.messageState}</span>
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-muted">{item.id}</p>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <aside className="rounded-2xl border border-border bg-surface p-5 shadow-card xl:sticky xl:top-6 xl:self-start">
        <h2 className="font-semibold">セッション詳細</h2>
        {detailLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中
          </div>
        ) : detail ? (
          <div className="mt-4 space-y-5">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{detail.session.title}</p>
              <p className="text-muted">
                ID: <span className="font-mono">{detail.session.id}</span>
              </p>
              <p className="text-muted">期限: {formatDate(detail.session.expiresAt)}</p>
              <p className="text-muted">
                Discord message: {detail.session.messageId ?? '未投稿・復旧待ち'}
              </p>
              {detail.session.lastErrorName ? (
                <p className="text-destructive">{detail.session.lastErrorName}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAction('split')}
                disabled={!pluginEnabled || loading || detail.session.status !== 'open'}
                className="rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                分割実行
              </button>
              <button
                type="button"
                onClick={() => void runAction('reroll')}
                disabled={!pluginEnabled || loading || detail.session.status !== 'split'}
                className="rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                再抽選
              </button>
              <button
                type="button"
                onClick={() => void runAction('close')}
                disabled={
                  !pluginEnabled || loading || ['closed', 'expired'].includes(detail.session.status)
                }
                className="rounded-xl border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50"
              >
                強制終了
              </button>
            </div>

            <form onSubmit={addParticipant} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserPlus className="h-4 w-4" /> 参加者追加・score更新
              </div>
              <div className="mt-3">
                <DiscordUserPicker
                  guildId={guildId}
                  value={participantUserId || null}
                  includeBots={false}
                  placeholder="ユーザー名・表示名・IDで検索"
                  onChange={(next) =>
                    setParticipantUserId(Array.isArray(next) ? (next[0] ?? '') : (next ?? ''))
                  }
                />
              </div>
              <label className="mt-2 block text-sm">
                <span className="mb-1.5 block text-muted">score</span>
                <input
                  className={inputClass}
                  type="number"
                  min={-100000}
                  max={100000}
                  value={participantScore}
                  onChange={(event) => setParticipantScore(Number(event.target.value))}
                />
              </label>
              <button
                type="submit"
                disabled={
                  !pluginEnabled ||
                  loading ||
                  !participantUserId ||
                  detail.session.status !== 'open'
                }
                className="mt-2 inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" /> 反映
              </button>
            </form>

            <div>
              <h3 className="text-sm font-medium">参加者</h3>
              <div className="mt-2 space-y-2">
                {detail.participants.map((participant) => (
                  <div
                    key={participant.userId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm"
                  >
                    <div>
                      <p className="font-mono text-xs">{participant.userId}</p>
                      <p className="mt-1 text-xs text-muted">score {participant.score}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeParticipant(participant.userId)}
                      disabled={
                        !pluginEnabled ||
                        loading ||
                        detail.session.status !== 'open' ||
                        participant.userId === detail.session.creatorId
                      }
                      className="text-destructive disabled:opacity-30"
                      aria-label="参加者を削除"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {teams.length > 0 ? (
              <div>
                <h3 className="text-sm font-medium">チーム結果</h3>
                <div className="mt-2 space-y-2">
                  {teams.map((team) => (
                    <div
                      key={team.teamNumber}
                      className="rounded-xl border border-border p-3 text-sm"
                    >
                      <div className="flex justify-between gap-2 font-medium">
                        <span>Team {team.teamNumber}</span>
                        {detail.session.mode === 'balanced' ? (
                          <span>合計 {team.totalScore}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 break-words font-mono text-xs text-muted">
                        {team.members.map((member) => member.userId).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">一覧からセッションを選択してください。</p>
        )}

        {error ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            {notice}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function normalizeSession(value: unknown): TeamSplitSessionItem {
  const row = value as Record<string, unknown>;
  return {
    id: String(row['id']),
    creatorId: String(row['creatorId']),
    channelId: String(row['channelId']),
    messageId: typeof row['messageId'] === 'string' ? row['messageId'] : null,
    title: String(row['title']),
    teamCount: Number(row['teamCount']),
    mode: row['mode'] === 'balanced' ? 'balanced' : 'random',
    maxParticipants: Number(row['maxParticipants']),
    participantCount: Number(row['participantCount']),
    generation: Number(row['generation']),
    status: isStatus(row['status']) ? row['status'] : 'open',
    expiresAt: String(row['expiresAt']),
    splitAt: typeof row['splitAt'] === 'string' ? row['splitAt'] : null,
    closedAt: typeof row['closedAt'] === 'string' ? row['closedAt'] : null,
    messageState: String(row['messageState']),
    lastErrorName: typeof row['lastErrorName'] === 'string' ? row['lastErrorName'] : null,
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

function readTeams(value: unknown): TeamResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((team): team is TeamResult => {
    if (!team || typeof team !== 'object') return false;
    const candidate = team as Record<string, unknown>;
    return Number.isInteger(candidate['teamNumber']) && Array.isArray(candidate['members']);
  });
}

function isStatus(value: unknown): value is TeamSplitSessionItem['status'] {
  return value === 'open' || value === 'split' || value === 'closed' || value === 'expired';
}

function readError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return '処理に失敗しました';
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-background hover:border-primary/40'
      }`}
    >
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-muted">{description}</span>
    </button>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ja-JP') : value;
}

async function readResponseError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return readError(await response.json());
  }
  const body = (await response.text()).trim();
  return body || `HTTP ${response.status}`;
}
