'use client';

import { cloneElement, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { DiscordChannelPicker } from './discord-entity-picker';
import {
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

export interface DailyContentScheduleItem {
  id: string;
  channelId: string;
  title: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyContentDeliveryItem {
  id: string;
  dailyContentId: string;
  origin: 'scheduled' | 'manual';
  scheduledFor: string;
  status: 'pending' | 'queued' | 'processing' | 'retrying' | 'sent' | 'failed' | 'skipped';
  attemptCount: number;
  messageId: string | null;
  errorName: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

interface DailyContentFormState {
  title: string;
  channelId: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
}

const INPUT_CLASS_NAME =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

const COMMON_TIMEZONES = [
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

const EMPTY_FORM: DailyContentFormState = {
  title: '',
  channelId: '',
  content: '',
  scheduleTime: '09:00',
  timezone: 'Asia/Tokyo',
  enabled: true,
};

export function DailyContentManager({
  guildId,
  initialSchedules,
  initialDeliveries,
  defaultTimezone,
  maxContentLength,
  pluginEnabled,
  discordOptions,
}: {
  guildId: string;
  initialSchedules: DailyContentScheduleItem[];
  initialDeliveries: DailyContentDeliveryItem[];
  defaultTimezone: string;
  maxContentLength: number;
  pluginEnabled: boolean;
  discordOptions?: GuildConfigurationOptions | null;
}) {
  const router = useRouter();
  const [schedules, setSchedules] = useState(initialSchedules);
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DailyContentFormState>({
    ...EMPTY_FORM,
    timezone: defaultTimezone,
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setSchedules(initialSchedules), [initialSchedules]);
  useEffect(() => setDeliveries(initialDeliveries), [initialDeliveries]);
  useEffect(() => {
    if (!editingId) setForm((current) => ({ ...current, timezone: defaultTimezone }));
  }, [defaultTimezone, editingId]);

  const scheduleNames = useMemo(
    () =>
      new Map(schedules.map((schedule) => [schedule.id, schedule.title || schedule.scheduleTime])),
    [schedules],
  );

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusyKey('save');
    const endpoint = editingId
      ? `/api/guilds/${guildId}/daily-content/schedules/${editingId}`
      : `/api/guilds/${guildId}/daily-content/schedules`;
    try {
      await requestJson(endpoint, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setNotice(editingId ? 'スケジュールを更新しました' : 'スケジュールを作成しました');
      resetForm();
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyKey(null);
    }
  }

  function editSchedule(schedule: DailyContentScheduleItem) {
    clearMessages();
    setEditingId(schedule.id);
    setForm({
      title: schedule.title,
      channelId: schedule.channelId,
      content: schedule.content,
      scheduleTime: schedule.scheduleTime,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
    });
    document.getElementById('daily-content-editor')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function toggleSchedule(schedule: DailyContentScheduleItem) {
    clearMessages();
    setBusyKey(`toggle:${schedule.id}`);
    try {
      await requestJson(`/api/guilds/${guildId}/daily-content/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      setNotice(schedule.enabled ? 'スケジュールを停止しました' : 'スケジュールを有効化しました');
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteSchedule(schedule: DailyContentScheduleItem) {
    if (!window.confirm(`「${schedule.title || schedule.scheduleTime}」を削除しますか？`)) return;
    clearMessages();
    setBusyKey(`delete:${schedule.id}`);
    try {
      await requestJson(`/api/guilds/${guildId}/daily-content/schedules/${schedule.id}`, {
        method: 'DELETE',
      });
      if (editingId === schedule.id) resetForm();
      setNotice('スケジュールを削除しました');
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyKey(null);
    }
  }

  async function publishNow(schedule: DailyContentScheduleItem) {
    clearMessages();
    setBusyKey(`publish:${schedule.id}`);
    try {
      await requestJson(`/api/guilds/${guildId}/daily-content/schedules/${schedule.id}/publish`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setNotice('手動配信をキューへ追加しました');
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyKey(null);
    }
  }

  async function retryDelivery(delivery: DailyContentDeliveryItem) {
    clearMessages();
    setBusyKey(`retry:${delivery.id}`);
    try {
      await requestJson(`/api/guilds/${guildId}/daily-content/deliveries/${delivery.id}/retry`, {
        method: 'POST',
      });
      setNotice('失敗配信を再実行対象へ戻しました');
      router.refresh();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyKey(null);
    }
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, timezone: defaultTimezone });
  }

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

      <form
        id="daily-content-editor"
        onSubmit={submitSchedule}
        className="rounded-2xl border border-border bg-surface p-5 shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{editingId ? 'スケジュール編集' : '新規スケジュール'}</h2>
            <p className="mt-1 text-xs text-muted">
              時刻は指定timezoneの壁時計として毎日評価します。
            </p>
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-background"
            >
              新規作成へ戻す
            </button>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="タイトル">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              maxLength={100}
              className={INPUT_CLASS_NAME}
              placeholder="朝のお知らせ"
            />
          </Field>
          <Field label="配信先チャンネル">
            <DiscordChannelPicker
              options={discordOptions?.channels ?? []}
              value={form.channelId || null}
              placeholder="配信先チャンネルを検索"
              onChange={(next) =>
                setForm({
                  ...form,
                  channelId: Array.isArray(next) ? (next[0] ?? '') : (next ?? ''),
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted">
              チャンネル名またはIDで検索できます。JSON/APIには従来どおりDiscord IDを保存します。
            </p>
          </Field>
          <Field label="配信時刻">
            <input
              type="time"
              value={form.scheduleTime}
              onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })}
              required
              className={INPUT_CLASS_NAME}
            />
          </Field>
          <Field label="Timezone">
            <input
              list="daily-content-timezones"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              required
              className={INPUT_CLASS_NAME}
              placeholder="Asia/Tokyo"
              autoComplete="off"
            />
            <datalist id="daily-content-timezones">
              {COMMON_TIMEZONES.map((timezone) => (
                <option key={timezone} value={timezone} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-muted">
              主要Timezoneから選択するか、IANA timezoneを直接入力できます。
            </p>
          </Field>
          <label className="md:col-span-2">
            <span className="text-xs font-medium text-muted">本文</span>
            <textarea
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              required
              maxLength={maxContentLength}
              rows={6}
              className={`${INPUT_CLASS_NAME} mt-1 resize-y`}
              placeholder="毎日配信する内容"
            />
            <span className="mt-1 block text-right text-xs text-muted">
              {form.content.length} / {maxContentLength}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              className="h-4 w-4 rounded border-border"
            />
            作成後すぐに有効化する
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={busyKey === 'save'}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {busyKey === 'save' ? '保存中…' : editingId ? '更新する' : '作成する'}
          </button>
        </div>
      </form>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">スケジュール</h2>
          <span className="text-xs text-muted">{schedules.length}件</span>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {schedules.length === 0 ? (
            <EmptyState text="スケジュールはまだありません。" />
          ) : (
            schedules.map((schedule) => (
              <article
                key={schedule.id}
                className="rounded-2xl border border-border bg-surface p-5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium">
                        {schedule.title || `${schedule.scheduleTime} の配信`}
                      </h3>
                      <StatusBadge status={schedule.enabled ? 'enabled' : 'disabled'} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-mono">{schedule.scheduleTime}</span> {schedule.timezone}{' '}
                      · {formatChannelLabel(schedule.channelId, discordOptions)}
                    </p>
                  </div>
                  <CalendarClock className="h-5 w-5 shrink-0 text-muted" />
                </div>
                <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-sm text-foreground/90">
                  {schedule.content}
                </p>
                <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <div>
                    <dt>次回配信</dt>
                    <dd className="mt-0.5 text-foreground">{formatDate(schedule.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>最終成功</dt>
                    <dd className="mt-0.5 text-foreground">{formatDate(schedule.lastSentAt)}</dd>
                  </div>
                </dl>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <ActionButton
                    onClick={() => editSchedule(schedule)}
                    icon={<Pencil />}
                    label="編集"
                  />
                  <ActionButton
                    onClick={() => toggleSchedule(schedule)}
                    disabled={busyKey === `toggle:${schedule.id}`}
                    icon={schedule.enabled ? <CirclePause /> : <Play />}
                    label={schedule.enabled ? '停止' : '有効化'}
                  />
                  <ActionButton
                    onClick={() => publishNow(schedule)}
                    disabled={!pluginEnabled || busyKey === `publish:${schedule.id}`}
                    icon={<Send />}
                    label="今すぐ配信"
                  />
                  <ActionButton
                    onClick={() => deleteSchedule(schedule)}
                    disabled={busyKey === `delete:${schedule.id}`}
                    icon={<Trash2 />}
                    label="削除"
                    destructive
                  />
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">配信履歴</h2>
          <span className="text-xs text-muted">直近{deliveries.length}件</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          {deliveries.length === 0 ? (
            <EmptyState text="配信履歴はまだありません。" />
          ) : (
            <div className="divide-y divide-border">
              {deliveries.map((delivery) => {
                const retryable = delivery.status === 'failed' || delivery.status === 'skipped';
                return (
                  <div key={delivery.id} className="flex flex-wrap items-center gap-3 p-4">
                    <DeliveryIcon status={delivery.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {scheduleNames.get(delivery.dailyContentId) ?? delivery.dailyContentId}
                        </p>
                        <StatusBadge status={delivery.status} />
                        <span className="text-xs text-muted">
                          {delivery.origin === 'manual' ? '手動' : '定時'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        予定 {formatDate(delivery.scheduledFor)} · 試行 {delivery.attemptCount}回
                        {delivery.errorName ? ` · ${delivery.errorName}` : ''}
                      </p>
                    </div>
                    {retryable ? (
                      <ActionButton
                        onClick={() => retryDelivery(delivery)}
                        disabled={!pluginEnabled || busyKey === `retry:${delivery.id}`}
                        icon={<RefreshCw />}
                        label="再実行"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatChannelLabel(
  channelId: string,
  discordOptions?: GuildConfigurationOptions | null,
): string {
  const channel = discordOptions?.channels.find((candidate) => candidate.id === channelId);
  return channel ? `#${channel.name}` : `#${channelId}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
  destructive = false,
}: {
  onClick(): void;
  disabled?: boolean;
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-40 ${
        destructive
          ? 'border-destructive/30 text-destructive hover:bg-destructive/5'
          : 'border-border hover:bg-background'
      }`}
    >
      {cloneElement(icon, { className: 'h-3.5 w-3.5' })}
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    enabled: '有効',
    disabled: '停止',
    pending: '待機',
    queued: 'Queue済み',
    processing: '配信中',
    retrying: '再試行待ち',
    sent: '成功',
    failed: '失敗',
    skipped: 'スキップ',
  };
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
      {label[status] ?? status}
    </span>
  );
}

function DeliveryIcon({ status }: { status: DailyContentDeliveryItem['status'] }) {
  if (status === 'sent') return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === 'failed' || status === 'skipped') {
    return <TriangleAlert className="h-5 w-5 text-destructive" />;
  }
  return <CalendarClock className="h-5 w-5 text-muted" />;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
      {text}
    </div>
  );
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'リクエストに失敗しました');
  }
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました';
}

function formatDate(value: string | null): string {
  if (!value) return '未定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
