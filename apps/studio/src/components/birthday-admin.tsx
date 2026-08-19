'use client';

import { useState } from 'react';
import {
  buildBirthdayCsv,
  daysInBirthdayMonth,
  filterBirthdayRegistrations,
  MIN_BIRTH_YEAR,
  type BirthdayRegistration,
} from '@/lib/birthday-admin-core';
import { DiscordUserPicker } from './discord-user-picker';

const SAVE_TIMEOUT_MS = 15_000;

type BirthdayAdminPayload = {
  error?: string;
  registrations?: BirthdayRegistration[];
};

export function BirthdayAdmin({
  guildId,
  initialRegistrations,
  canEdit,
  showCelebrationStats,
}: {
  guildId: string;
  initialRegistrations: BirthdayRegistration[];
  canEdit: boolean;
  showCelebrationStats: boolean;
}) {
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [userId, setUserId] = useState<string | null>(null);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [birthYear, setBirthYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [listMonth, setListMonth] = useState<number | null>(null);

  const existing = userId
    ? (registrations.find((registration) => registration.userId === userId) ?? null)
    : null;
  const maxDay = daysInBirthdayMonth(month);
  const currentYear = new Date().getFullYear();
  const visibleRegistrations = filterBirthdayRegistrations(registrations, listQuery, listMonth);

  function selectUser(value: string | string[] | null) {
    const nextUserId = typeof value === 'string' ? value : null;
    setUserId(nextUserId);
    setStatus('');
    if (!nextUserId) {
      setBirthYear('');
      return;
    }

    const registration = registrations.find((candidate) => candidate.userId === nextUserId);
    setMonth(registration?.month ?? 1);
    setDay(registration?.day ?? 1);
    setBirthYear(registration?.birthYear?.toString() ?? '');
  }

  function selectMonth(nextMonth: number) {
    setMonth(nextMonth);
    setDay((current) => Math.min(current, daysInBirthdayMonth(nextMonth)));
  }

  function selectRegistration(registration: BirthdayRegistration) {
    if (!canEdit) return;
    setUserId(registration.userId);
    setMonth(registration.month);
    setDay(registration.day);
    setBirthYear(registration.birthYear?.toString() ?? '');
    setStatus('一覧から登録済みメンバーを選択しました。');
  }

  function exportCsv() {
    const csv = `\uFEFF${buildBirthdayCsv(registrations)}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `birthday-registrations-${guildId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Birthday登録一覧をCSVで出力しました。');
  }

  async function update(action: 'set' | 'remove') {
    if (!canEdit || !userId || (action === 'remove' && !existing)) return;
    if (action === 'remove' && !window.confirm('このメンバーの誕生日登録を解除しますか？')) {
      return;
    }

    const normalizedBirthYear = birthYear.trim();
    if (action === 'set' && normalizedBirthYear) {
      const parsedYear = Number(normalizedBirthYear);
      if (
        !Number.isInteger(parsedYear) ||
        parsedYear < MIN_BIRTH_YEAR ||
        parsedYear > currentYear
      ) {
        setStatus(`生年は${MIN_BIRTH_YEAR}〜${currentYear}年で指定してください。`);
        return;
      }
    }

    setBusy(true);
    setStatus(action === 'set' ? '保存中…' : '登録解除中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify(
          action === 'set'
            ? {
                action,
                userId,
                month,
                day,
                birthYear: normalizedBirthYear ? Number(normalizedBirthYear) : null,
              }
            : { action, userId },
        ),
      });
      const payload = (await response.json().catch(() => null)) as BirthdayAdminPayload | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? '誕生日管理操作に失敗しました');
      }
      if (payload?.registrations) setRegistrations(payload.registrations);
      setStatus(action === 'set' ? '誕生日を保存しました。' : '誕生日登録を解除しました。');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '保存がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : '誕生日管理操作に失敗しました',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Member Birthday</h2>
          <p className="mt-1 text-sm text-muted">
            月日は必須、生年は任意です。生年を登録すると年齢付きのお祝いとBirthday
            Cardに利用できます。登録済み {registrations.length} 人。
          </p>
        </div>
        {!canEdit ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
            IAM閲覧モード
          </span>
        ) : null}
      </div>

      {canEdit ? (
        <>
          <div>
            <label className="mb-2 block text-xs font-medium text-muted">対象メンバー</label>
            <DiscordUserPicker
              guildId={guildId}
              value={userId}
              onChange={selectUser}
              includeBots={false}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              月
              <select
                value={month}
                onChange={(event) => selectMonth(Number(event.target.value))}
                disabled={!userId || busy}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 disabled:opacity-50"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}月
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              日
              <select
                value={day}
                onChange={(event) => setDay(Number(event.target.value))}
                disabled={!userId || busy}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 disabled:opacity-50"
              >
                {Array.from({ length: maxDay }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}日
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              生年（任意）
              <input
                type="number"
                inputMode="numeric"
                min={MIN_BIRTH_YEAR}
                max={currentYear}
                value={birthYear}
                onChange={(event) => setBirthYear(event.target.value)}
                disabled={!userId || busy}
                placeholder="例: 2000"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 disabled:opacity-50"
              />
            </label>
          </div>

          {existing ? (
            <div className="rounded-xl border border-border bg-background p-3 text-xs text-muted">
              <p>
                現在の登録: {existing.birthYear ? `${existing.birthYear}年 ` : ''}
                {existing.month}月{existing.day}日
              </p>
              {showCelebrationStats ? (
                <p className="mt-1">
                  Hertaがお祝いした回数: {existing.celebrationCount ?? 0}回
                  {existing.latestServerBirthdayNumber
                    ? ` ／ サーバー参加後 ${existing.latestServerBirthdayNumber}回目の誕生日`
                    : ''}
                  {existing.latestAge !== null && existing.latestAge !== undefined
                    ? ` ／ 最新年齢 ${existing.latestAge}歳`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void update('set')}
              disabled={!userId || busy}
              className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {existing ? '更新' : '登録'}
            </button>
            <button
              type="button"
              onClick={() => void update('remove')}
              disabled={!existing || busy}
              className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              登録解除
            </button>
          </div>
        </>
      ) : null}

      <div className="space-y-4 border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">登録済みBirthday</h3>
            <p className="mt-1 text-xs text-muted">
              月日順で確認できます。生年はBirthdayの閲覧権限を持つStudioユーザーだけが確認でき、公開Botコマンドの一覧には表示しません。
            </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={registrations.length === 0}
            className="rounded-xl border border-border px-3 py-2 text-xs disabled:opacity-50"
          >
            CSV出力
          </button>
        </div>

        {!showCelebrationStats ? (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-muted">
            祝い実績はIAM権限により非表示です。
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <label className="text-xs font-medium text-muted">
            Discord IDで絞り込み
            <input
              value={listQuery}
              onChange={(event) => setListQuery(event.target.value)}
              inputMode="numeric"
              placeholder="123456789012345678"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="text-xs font-medium text-muted">
            月
            <select
              value={listMonth ?? ''}
              onChange={(event) =>
                setListMonth(event.target.value ? Number(event.target.value) : null)
              }
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">すべて</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}月
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-xs text-muted">
          {visibleRegistrations.length} / {registrations.length} 件を表示
        </p>

        {visibleRegistrations.length > 0 ? (
          <div className="max-h-96 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-3 py-2 font-medium">誕生日</th>
                  <th className="px-3 py-2 font-medium">Discord ID</th>
                  {showCelebrationStats ? (
                    <th className="px-3 py-2 font-medium">祝い実績</th>
                  ) : null}
                  {canEdit ? <th className="px-3 py-2 text-right font-medium">操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRegistrations.map((registration) => (
                  <tr key={registration.userId} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 tabular-nums">
                      <span className="block">
                        {registration.month}月{registration.day}日
                      </span>
                      <span className="text-xs text-muted">
                        {registration.birthYear
                          ? `${registration.birthYear}年生まれ`
                          : '生年未登録'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{registration.userId}</td>
                    {showCelebrationStats ? (
                      <td className="px-3 py-2 text-xs">
                        {registration.celebrationCount ?? 0}回
                        {registration.latestServerBirthdayNumber
                          ? ` ／ 参加後${registration.latestServerBirthdayNumber}回目`
                          : ''}
                      </td>
                    ) : null}
                    {canEdit ? (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => selectRegistration(registration)}
                          className="rounded-lg border border-border px-2 py-1 text-xs"
                        >
                          編集
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
            条件に一致するBirthday登録はありません。
          </p>
        )}
      </div>

      <p className="min-h-5 text-sm text-muted" aria-live="polite">
        {busy ? '処理中…' : status}
      </p>
    </section>
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
