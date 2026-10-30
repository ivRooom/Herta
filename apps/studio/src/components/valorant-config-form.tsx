'use client';

import { useEffect, useRef, useState } from 'react';

type Agent = { agentId: string; agentName: string; displayName: string; enabled: boolean };
const EMPTY: Agent = { agentId: '', agentName: '', displayName: '', enabled: true };
const button =
  'min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';

export function ValorantConfigForm({
  guildId,
  initialEnabled,
  initialConfig,
}: {
  guildId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [commandsEnabled, setCommandsEnabled] = useState(initialConfig.enabled !== false);
  const [maxParticipants, setMaxParticipants] = useState(
    typeof initialConfig.maxParticipants === 'number' ? initialConfig.maxParticipants : 5,
  );
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(
    typeof initialConfig.sessionDurationMinutes === 'number' ? initialConfig.sessionDurationMinutes : 30,
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Agent>({ ...EMPTY });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const endpoint = `/api/guilds/${guildId}/valorant/agents`;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '一覧を取得できません。');
      setAgents(result.agents);
      setInitialized(result.initialized);
      setCanWrite(result.canWrite);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [endpoint]);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);

  async function mutate(method: string, body?: unknown, agentId?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(
        agentId ? `${endpoint}/${encodeURIComponent(agentId)}` : endpoint,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '保存できませんでした。');
      setAgents(result.agents);
      setInitialized(result.initialized);
      setDraft({ ...EMPTY });
      setEditing(false);
      setDeleting(null);
      setMessage('保存しました。Botの次回抽選から反映されます。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    } finally {
      setBusy(false);
    }
  }
  async function savePlugin() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/guilds/${guildId}/plugins/valorant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          configPatch: { enabled: commandsEnabled, maxParticipants, sessionDurationMinutes },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Plugin設定を保存できません。');
      setMessage('Plugin設定を保存しました。Slash Commandの登録はRuntime同期で反映されます。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '通信に失敗しました。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <h2 className="text-lg font-semibold">VALORANT Plugin設定</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Pluginを有効にする
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={commandsEnabled}
              disabled={busy}
              onChange={(event) => setCommandsEnabled(event.target.checked)}
            />
            コマンドを有効にする
          </label>
          <label className="flex flex-col gap-1 text-sm">
            最大参加人数（1〜5人）
            <input className="input w-28" type="number" min={1} max={5} step={1}
              value={maxParticipants} disabled={busy}
              onChange={(event) => setMaxParticipants(Number(event.target.value))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            募集期限（5〜180分）
            <input className="input w-28" type="number" min={5} max={180} step={1}
              value={sessionDurationMinutes} disabled={busy}
              onChange={(event) => setSessionDurationMinutes(Number(event.target.value))} />
          </label>
          <button className={button}
            disabled={busy || !Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 5 ||
              !Number.isInteger(sessionDurationMinutes) || sessionDurationMinutes < 5 || sessionDurationMinutes > 180}
            onClick={() => void savePlugin()}>
            Plugin設定を保存
          </button>
        </div>
      </section>
      <section
        className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6"
        aria-busy={loading || busy}
      >
        <h2 className="text-lg font-semibold">エージェント管理</h2>
        <p className="mt-2 text-sm text-muted">
          このサーバーの候補を管理します。無効なエージェントは抽選されません。
        </p>
        {loading ? (
          <p role="status" className="mt-4">
            読み込み中…
          </p>
        ) : (
          <>
            <p className="mt-4 font-medium">
              登録 {agents.length}件 · 有効 {agents.filter((agent) => agent.enabled).length}件
            </p>
            {!initialized && (
              <p className="mt-2 text-sm text-muted">
                初期登録前の互換設定を表示しています。最初の保存時に現在の有効候補を引き継ぎます。
              </p>
            )}
            <button
              className={`${button} mt-4`}
              disabled={busy || !canWrite}
              onClick={() => void mutate('POST', { action: 'initialize' })}
            >
              公式候補を初期登録・不足分を追加
            </button>
            <p className="mt-2 text-xs text-muted">
              既存の名前・有効状態は上書きしません。削除した公式候補は再追加されます。
            </p>
            {agents.length === 0 ? (
              <p className="mt-4 rounded-xl border border-border p-4">
                エージェントがありません。初期登録または新規登録してください。
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {agents.map((agent) => (
                  <li
                    key={agent.agentId}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 break-words">
                      <p className="font-semibold">{agent.displayName}</p>
                      <p className="text-sm text-muted">
                        {agent.agentName} · {agent.agentId}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`${agent.displayName}を有効にする`}
                          checked={agent.enabled}
                          disabled={busy || !canWrite}
                          onChange={(event) =>
                            void mutate(
                              'PATCH',
                              {
                                agentId: agent.agentId,
                                agentName: agent.agentName,
                                displayName: agent.displayName,
                                enabled: event.target.checked,
                              },
                              agent.agentId,
                            )
                          }
                        />
                        有効
                      </label>
                      <button
                        className={button}
                        disabled={busy || !canWrite}
                        onClick={() => {
                          setDraft(agent);
                          setEditing(true);
                          setError('');
                        }}
                      >
                        編集<span className="sr-only"> {agent.displayName}</span>
                      </button>
                      <button
                        className={`${button} text-destructive`}
                        disabled={busy || !canWrite}
                        onClick={() => setDeleting(agent)}
                      >
                        削除<span className="sr-only"> {agent.displayName}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-6 space-y-4 border-t border-border pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(
                  editing ? 'PATCH' : 'POST',
                  {
                    agentId: draft.agentId,
                    agentName: draft.agentName,
                    displayName: draft.displayName,
                    enabled: draft.enabled,
                  },
                  editing ? draft.agentId : undefined,
                );
              }}
            >
              <h3 className="font-semibold">
                {editing ? 'エージェントを編集' : 'エージェントを新規登録'}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm">
                  Agent ID
                  <input
                    className="input mt-1"
                    required
                    pattern="[a-z0-9][a-z0-9-]{0,63}"
                    maxLength={64}
                    disabled={busy || editing || !canWrite}
                    value={draft.agentId}
                    onChange={(event) => setDraft({ ...draft, agentId: event.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Agent Name
                  <input
                    className="input mt-1"
                    required
                    maxLength={50}
                    disabled={busy || !canWrite}
                    value={draft.agentName}
                    onChange={(event) => setDraft({ ...draft, agentName: event.target.value })}
                  />
                </label>
                <label className="text-sm">
                  表示名
                  <input
                    className="input mt-1"
                    required
                    maxLength={50}
                    disabled={busy || !canWrite}
                    value={draft.displayName}
                    onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                  />
                </label>
              </div>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={busy || !canWrite}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                抽選対象として有効にする
              </label>
              <div className="flex gap-2">
                <button className={button} disabled={busy || !canWrite} type="submit">
                  {editing ? '変更を保存' : '新規登録'}
                </button>
                {editing && (
                  <button
                    className={button}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDraft({ ...EMPTY });
                      setEditing(false);
                    }}
                  >
                    編集をキャンセル
                  </button>
                )}
              </div>
            </form>
          </>
        )}
        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-destructive p-4 text-sm">
            <p>{error}</p>
            <button
              className={`${button} mt-2`}
              disabled={busy || loading}
              onClick={() => void load()}
            >
              一覧を再取得
            </button>
          </div>
        )}
        {message && (
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
        )}
        {busy && (
          <p role="status" className="mt-2 text-sm text-muted">
            保存中…
          </p>
        )}
      </section>
      <dialog
        ref={dialog}
        aria-labelledby="valorant-delete-title"
        className="max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/50"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(null);
        }}
      >
        <h2 id="valorant-delete-title" className="font-semibold">
          エージェントを削除しますか？
        </h2>
        <p className="mt-3 break-words text-sm">
          {deleting?.displayName} をこのサーバーの候補から削除します。
        </p>
        <div className="mt-5 flex gap-3">
          <button autoFocus className={button} disabled={busy} onClick={() => setDeleting(null)}>
            キャンセル
          </button>
          <button
            className={`${button} text-destructive`}
            disabled={busy}
            onClick={() => void mutate('DELETE', undefined, deleting!.agentId)}
          >
            削除を確定
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
