'use client';

import { Cake, LockKeyhole, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

const SAVE_TIMEOUT_MS = 15_000;

export function GuildAnniversarySettings({
  guildId,
  initialDate,
  canEdit,
}: {
  guildId: string;
  initialDate: string | null;
  canEdit: boolean;
}) {
  const [date, setDate] = useState(initialDate ?? '');
  const [savedDate, setSavedDate] = useState(initialDate ?? '');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const dirty = date !== savedDate;

  async function save() {
    if (!canEdit || !date || !dirty || pending) return;
    setPending(true);
    setStatus('保存中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/anniversary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify({ anniversaryDate: date }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; anniversary?: { anniversaryDate?: string } | null }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? 'サーバー周年日の保存に失敗しました');
      const next = payload?.anniversary?.anniversaryDate ?? date;
      setDate(next);
      setSavedDate(next);
      setStatus('サーバー周年日を保存しました');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '保存がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : 'サーバー周年日の保存に失敗しました',
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!canEdit || !savedDate || pending) return;
    if (!window.confirm('Botの誕生日（サーバー周年日）を解除しますか？')) return;
    setPending(true);
    setStatus('解除中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/anniversary`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? 'サーバー周年日の解除に失敗しました');
      setDate('');
      setSavedDate('');
      setStatus('サーバー周年日を解除しました');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '解除がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : 'サーバー周年日の解除に失敗しました',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Cake className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Botの誕生日 / サーバー周年</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              このサーバーでのHerta自身の誕生日として扱う日です。サーバーの周年記念日・開設記念日を登録できます。
            </p>
          </div>
        </div>
        {!canEdit ? (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> 閲覧のみ
          </span>
        ) : null}
      </div>

      <div className="mt-5 max-w-md">
        <label className="text-sm font-medium" htmlFor="guild-anniversary-date">
          周年日
        </label>
        <div className="mt-1 flex w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2">
          <input
            id="guild-anniversary-date"
            type="date"
            max={today}
            value={date}
            disabled={pending || !canEdit}
            onChange={(event) => {
              setDate(event.target.value);
              setStatus('未保存の変更があります');
            }}
            className="block w-full min-w-0 border-0 bg-transparent p-0 text-base disabled:opacity-70"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          将来日は設定できません。周年の自動投稿ルールはBirthday Roleの次フェーズでこの日付を利用できます。
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canEdit || !date || !dirty || pending}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" /> {pending ? '処理中…' : '周年日を保存'}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={!canEdit || !savedDate || pending}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> 解除
        </button>
      </div>

      <p className="mt-3 min-h-5 text-sm text-muted" aria-live="polite">
        {status || (savedDate ? `現在の周年日: ${savedDate}` : '周年日は未設定です')}
      </p>
    </section>
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
