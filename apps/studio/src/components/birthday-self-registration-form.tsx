'use client';

import { CalendarHeart, Save, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import type { BirthdayRegistration } from '@/lib/birthday-admin-core';

const REQUEST_TIMEOUT_MS = 15_000;

export function BirthdaySelfRegistrationForm({
  guildId,
  displayName,
  initialRegistration,
  currentYear,
  allowRegistration,
}: {
  guildId: string;
  displayName: string;
  initialRegistration: BirthdayRegistration | null;
  currentYear: number;
  allowRegistration: boolean;
}) {
  const birthYearHelpId = useId();
  const [month, setMonth] = useState(String(initialRegistration?.month ?? ''));
  const [day, setDay] = useState(String(initialRegistration?.day ?? ''));
  const [birthYear, setBirthYear] = useState(String(initialRegistration?.birthYear ?? ''));
  const [hasRegistration, setHasRegistration] = useState(initialRegistration !== null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(
    allowRegistration
      ? initialRegistration
        ? '登録済みの誕生日を表示しています。'
        : '誕生日はまだ登録されていません。'
      : '本人による登録・更新は管理者設定で無効です。登録済みデータの削除はできます。',
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !allowRegistration) {
      if (!allowRegistration) {
        setStatus('本人による誕生日登録は管理者設定で無効になっています。');
      }
      return;
    }
    setPending(true);
    setStatus('保存中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday/self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, day, birthYear }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        registration?: BirthdayRegistration;
      } | null;
      if (!response.ok || !payload?.registration) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '誕生日を保存できませんでした',
        );
      }
      setMonth(String(payload.registration.month));
      setDay(String(payload.registration.day));
      setBirthYear(String(payload.registration.birthYear ?? ''));
      setHasRegistration(true);
      setStatus('誕生日を保存しました。');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '保存がタイムアウトしました。通信状態を確認して再試行してください。'
          : error instanceof Error
            ? error.message
            : '誕生日を保存できませんでした',
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!hasRegistration || pending) return;
    if (!window.confirm('登録済みの誕生日を削除しますか？')) return;
    setPending(true);
    setStatus('削除中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday/self`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        deleted?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '誕生日登録を削除できませんでした',
        );
      }
      setMonth('');
      setDay('');
      setBirthYear('');
      setHasRegistration(false);
      setStatus(payload?.deleted ? '誕生日登録を削除しました。' : '登録済みの誕生日はありません。');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '削除がタイムアウトしました。通信状態を確認して再試行してください。'
          : error instanceof Error
            ? error.message
            : '誕生日登録を削除できませんでした',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-3xl border border-primary/20 bg-surface p-5 shadow-card sm:p-7">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarHeart className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">誕生日を登録</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {displayName} として登録します。対象はログイン中のDiscordアカウント本人だけです。
          </p>
        </div>
      </div>

      {!allowRegistration ? (
        <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-sm leading-6 text-amber-300">
          サーバー管理者が本人による誕生日登録・更新を無効にしています。登録済みデータの削除は引き続き利用できます。
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset disabled={pending || !allowRegistration} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">誕生日</legend>
          <label className="space-y-1.5 text-sm font-medium">
            月
            <input
              required
              inputMode="numeric"
              min={1}
              max={12}
              type="number"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            日
            <input
              required
              inputMode="numeric"
              min={1}
              max={31}
              type="number"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
            生年（任意）
            <input
              inputMode="numeric"
              aria-describedby={birthYearHelpId}
              min={1900}
              max={currentYear}
              type="number"
              value={birthYear}
              onChange={(event) => setBirthYear(event.target.value)}
              placeholder="例: 2000"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            />
          </label>
          <span
            id={birthYearHelpId}
            className="text-xs font-normal leading-5 text-muted sm:col-span-2"
          >
            年齢表示を利用したい場合だけ入力してください。未入力でも月日を登録できます。
          </span>
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={pending || !allowRegistration}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {pending ? '処理中…' : allowRegistration ? '誕生日を保存' : '本人登録は無効'}
          </button>
          {hasRegistration ? (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              登録を削除
            </button>
          ) : null}
        </div>
      </form>

      <p className="mt-4 min-h-5 text-sm text-muted" aria-live="polite" role="status">
        {status}
      </p>
    </section>
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
