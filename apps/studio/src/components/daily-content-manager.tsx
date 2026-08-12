'use client';

import {
  cloneElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { DiscordChannelPicker } from './discord-entity-picker';
import {
  Bold,
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Code2,
  Eye,
  ImageIcon,
  Italic,
  Link2,
  ListPlus,
  MessageSquareReply,
  Pencil,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Send,
  Sparkles,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
} from 'lucide-react';

export interface MessageStudioEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface MessageStudioEmbedData {
  title?: string;
  description?: string;
  color?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  footerText?: string;
  fields?: MessageStudioEmbedField[];
}

export interface DailyContentScheduleItem {
  id: string;
  channelId: string;
  title: string;
  content: string;
  scheduleTime: string;
  timezone: string;
  enabled: boolean;
  recurrenceType: 'once' | 'daily' | 'weekly';
  onceAt: string | null;
  weekdays: number[];
  messageFormat: 'text' | 'embed';
  embed: MessageStudioEmbedData | null;
  publishAnnouncement: boolean;
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
  recurrenceType: 'once' | 'daily' | 'weekly';
  onceAt: string;
  weekdays: number[];
  messageFormat: 'text' | 'embed';
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  imageUrl: string;
  thumbnailUrl: string;
  footerText: string;
  fields: MessageStudioEmbedField[];
  publishAnnouncement: boolean;
}

const INPUT_CLASS_NAME =
  'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring';
const WEEKDAYS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 7, label: '日' },
] as const;
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

function createEmptyForm(
  defaultTimezone: string,
  defaultChannelId: string | null,
): DailyContentFormState {
  return {
    title: '',
    channelId: defaultChannelId ?? '',
    content: '',
    scheduleTime: '09:00',
    timezone: defaultTimezone,
    enabled: true,
    recurrenceType: 'once',
    onceAt: '',
    weekdays: [1, 2, 3, 4, 5],
    messageFormat: 'text',
    embedTitle: '',
    embedDescription: '',
    embedColor: '#5865F2',
    imageUrl: '',
    thumbnailUrl: '',
    footerText: '',
    fields: [],
    publishAnnouncement: false,
  };
}

export function DailyContentManager({
  guildId,
  initialSchedules,
  initialDeliveries,
  defaultTimezone,
  defaultChannelId,
  maxContentLength,
  pluginEnabled,
  allowAnnouncementCrosspost,
  allowUserMentions,
  discordOptions,
}: {
  guildId: string;
  initialSchedules: DailyContentScheduleItem[];
  initialDeliveries: DailyContentDeliveryItem[];
  defaultTimezone: string;
  defaultChannelId: string | null;
  maxContentLength: number;
  pluginEnabled: boolean;
  allowAnnouncementCrosspost: boolean;
  allowUserMentions: boolean;
  discordOptions?: GuildConfigurationOptions | null;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DailyContentFormState>(() =>
    createEmptyForm(defaultTimezone, defaultChannelId),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setSchedules(initialSchedules), [initialSchedules]);
  useEffect(() => setDeliveries(initialDeliveries), [initialDeliveries]);
  useEffect(() => {
    setForm((current) =>
      current.onceAt ? current : { ...current, onceAt: nextLocalDateTime(current.timezone) },
    );
  }, []);
  useEffect(() => {
    if (!editingId) {
      setForm((current) => ({
        ...current,
        timezone: defaultTimezone,
        channelId: current.channelId || defaultChannelId || '',
      }));
    }
  }, [defaultChannelId, defaultTimezone, editingId]);

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
        body: JSON.stringify(toApiPayload(form)),
      });
      setNotice(
        editingId ? 'Message Studio投稿を更新しました' : 'Message Studio投稿を作成しました',
      );
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
      recurrenceType: schedule.recurrenceType,
      onceAt: schedule.onceAt
        ? toDateTimeLocal(schedule.onceAt, schedule.timezone)
        : nextLocalDateTime(schedule.timezone),
      weekdays: schedule.weekdays,
      messageFormat: schedule.messageFormat,
      embedTitle: schedule.embed?.title ?? '',
      embedDescription: schedule.embed?.description ?? '',
      embedColor: schedule.embed?.color ?? '#5865F2',
      imageUrl: schedule.embed?.imageUrl ?? '',
      thumbnailUrl: schedule.embed?.thumbnailUrl ?? '',
      footerText: schedule.embed?.footerText ?? '',
      fields: schedule.embed?.fields ?? [],
      publishAnnouncement: schedule.publishAnnouncement && allowAnnouncementCrosspost,
    });
    document.getElementById('message-studio-composer')?.scrollIntoView({ behavior: 'smooth' });
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
      setNotice(schedule.enabled ? '投稿を停止しました' : '投稿を有効化しました');
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
      setNotice('投稿を削除しました');
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
    setForm({
      ...createEmptyForm(defaultTimezone, defaultChannelId),
      onceAt: nextLocalDateTime(defaultTimezone),
    });
  }

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function wrapMarkdown(before: string, after = before, placeholder = 'テキスト') {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? form.content.length;
    const end = textarea?.selectionEnd ?? form.content.length;
    const selected = form.content.slice(start, end) || placeholder;
    const next = `${form.content.slice(0, start)}${before}${selected}${after}${form.content.slice(end)}`;
    setForm({ ...form, content: next });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function addField() {
    if (form.fields.length >= 25) return;
    setForm({ ...form, fields: [...form.fields, { name: '', value: '', inline: false }] });
  }

  function updateField(index: number, patch: Partial<MessageStudioEmbedField>) {
    setForm({
      ...form,
      fields: form.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    });
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
        id="message-studio-composer"
        onSubmit={submitSchedule}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card"
      >
        <div className="border-b border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">
                  {editingId ? 'Message Composer — 編集' : 'Message Composer'}
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted">
                お知らせ・定期投稿・Forum投稿を通常メッセージまたはEmbedで作成します。
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
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-5 p-5 xl:border-r xl:border-border">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="管理タイトル / Forumタイトル">
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  maxLength={100}
                  className={INPUT_CLASS_NAME}
                  placeholder="メンテナンスのお知らせ"
                />
              </Field>
              <Field label="投稿先">
                <DiscordChannelPicker
                  options={discordOptions?.channels ?? []}
                  value={form.channelId || null}
                  placeholder="チャンネル / Forum / Threadを検索"
                  onChange={(next) =>
                    setForm({
                      ...form,
                      channelId: Array.isArray(next) ? (next[0] ?? '') : (next ?? ''),
                    })
                  }
                />
              </Field>
            </div>

            <section className="rounded-2xl border border-border bg-background/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                配信タイミング
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(
                  [
                    ['once', '1回予約'],
                    ['daily', '毎日'],
                    ['weekly', '毎週'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm({ ...form, recurrenceType: value })}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      form.recurrenceType === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-surface'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {form.recurrenceType === 'once' ? (
                  <Field label="予約日時">
                    <input
                      type="datetime-local"
                      value={form.onceAt}
                      onChange={(event) => setForm({ ...form, onceAt: event.target.value })}
                      required
                      className={INPUT_CLASS_NAME}
                    />
                  </Field>
                ) : (
                  <Field label="配信時刻">
                    <input
                      type="time"
                      value={form.scheduleTime}
                      onChange={(event) => setForm({ ...form, scheduleTime: event.target.value })}
                      required
                      className={INPUT_CLASS_NAME}
                    />
                  </Field>
                )}
                <Field label="Timezone">
                  <input
                    list="message-studio-timezones"
                    value={form.timezone}
                    onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                    required
                    className={INPUT_CLASS_NAME}
                    placeholder="Asia/Tokyo"
                  />
                  <datalist id="message-studio-timezones">
                    {COMMON_TIMEZONES.map((timezone) => (
                      <option key={timezone} value={timezone} />
                    ))}
                  </datalist>
                </Field>
              </div>
              {form.recurrenceType === 'weekly' ? (
                <div className="mt-4">
                  <span className="text-xs font-medium text-muted">配信曜日</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {WEEKDAYS.map((weekday) => {
                      const active = form.weekdays.includes(weekday.value);
                      return (
                        <button
                          key={weekday.value}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              weekdays: active
                                ? form.weekdays.filter((value) => value !== weekday.value)
                                : [...form.weekdays, weekday.value].sort((a, b) => a - b),
                            })
                          }
                          className={`h-9 w-9 rounded-full border text-xs font-medium ${
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-surface'
                          }`}
                        >
                          {weekday.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  メッセージ形式
                </p>
                <div className="inline-flex rounded-xl border border-border p-1">
                  <FormatButton
                    active={form.messageFormat === 'text'}
                    onClick={() => setForm({ ...form, messageFormat: 'text' })}
                    label="通常"
                  />
                  <FormatButton
                    active={form.messageFormat === 'embed'}
                    onClick={() => setForm({ ...form, messageFormat: 'embed' })}
                    label="Embed"
                  />
                </div>
              </div>

              <div className="mt-3 block">
                <label htmlFor="message-studio-content" className="text-xs font-medium text-muted">
                  通常本文
                </label>
                <div className="mt-1 overflow-hidden rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
                  <div className="flex flex-wrap gap-1 border-b border-border p-2">
                    <ToolbarButton
                      icon={<Bold />}
                      label="太字"
                      onClick={() => wrapMarkdown('**')}
                    />
                    <ToolbarButton
                      icon={<Italic />}
                      label="斜体"
                      onClick={() => wrapMarkdown('*')}
                    />
                    <ToolbarButton
                      icon={<Underline />}
                      label="下線"
                      onClick={() => wrapMarkdown('__')}
                    />
                    <ToolbarButton
                      icon={<Strikethrough />}
                      label="取消"
                      onClick={() => wrapMarkdown('~~')}
                    />
                    <ToolbarButton
                      icon={<Code2 />}
                      label="コード"
                      onClick={() => wrapMarkdown('`')}
                    />
                    <ToolbarButton
                      icon={<Eye />}
                      label="スポイラー"
                      onClick={() => wrapMarkdown('||')}
                    />
                    <ToolbarButton
                      icon={<Quote />}
                      label="引用"
                      onClick={() => wrapMarkdown('> ', '', '引用文')}
                    />
                    <ToolbarButton
                      icon={<Link2 />}
                      label="リンク"
                      onClick={() => wrapMarkdown('[', '](https://)', '表示名')}
                    />
                  </div>
                  <textarea
                    id="message-studio-content"
                    ref={textareaRef}
                    value={form.content}
                    onChange={(event) => setForm({ ...form, content: event.target.value })}
                    maxLength={maxContentLength}
                    rows={7}
                    className="w-full resize-y bg-transparent px-3 py-3 text-sm outline-none"
                    placeholder="Discord Markdownを使って本文を入力…"
                  />
                </div>
                <span className="mt-1 block text-right text-xs text-muted">
                  {form.content.length} / {maxContentLength}
                </span>
              </div>
            </section>

            {form.messageFormat === 'embed' ? (
              <section className="space-y-4 rounded-2xl border border-border bg-background/50 p-4">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">Embed Builder</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Embedタイトル">
                    <input
                      value={form.embedTitle}
                      onChange={(event) => setForm({ ...form, embedTitle: event.target.value })}
                      maxLength={256}
                      className={INPUT_CLASS_NAME}
                      placeholder="重要なお知らせ"
                    />
                  </Field>
                  <Field label="Accent Color">
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={validColor(form.embedColor)}
                        onChange={(event) => setForm({ ...form, embedColor: event.target.value })}
                        className="h-10 w-12 rounded-xl border border-border bg-background p-1"
                      />
                      <input
                        value={form.embedColor}
                        onChange={(event) => setForm({ ...form, embedColor: event.target.value })}
                        maxLength={7}
                        className={INPUT_CLASS_NAME}
                        placeholder="#5865F2"
                      />
                    </div>
                  </Field>
                </div>
                <Field label="Embed本文">
                  <textarea
                    value={form.embedDescription}
                    onChange={(event) => setForm({ ...form, embedDescription: event.target.value })}
                    maxLength={4096}
                    rows={6}
                    className={`${INPUT_CLASS_NAME} resize-y`}
                    placeholder="Embed本文にもDiscord Markdownを利用できます。"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="画像URL">
                    <input
                      type="url"
                      value={form.imageUrl}
                      onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
                      className={INPUT_CLASS_NAME}
                      placeholder="https://example.com/banner.png"
                    />
                  </Field>
                  <Field label="サムネイルURL">
                    <input
                      type="url"
                      value={form.thumbnailUrl}
                      onChange={(event) => setForm({ ...form, thumbnailUrl: event.target.value })}
                      className={INPUT_CLASS_NAME}
                      placeholder="https://example.com/icon.png"
                    />
                  </Field>
                </div>
                <Field label="Footer">
                  <input
                    value={form.footerText}
                    onChange={(event) => setForm({ ...form, footerText: event.target.value })}
                    maxLength={2048}
                    className={INPUT_CLASS_NAME}
                    placeholder="Herta Operations"
                  />
                </Field>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted">
                      Fields ({form.fields.length}/25)
                    </span>
                    <button
                      type="button"
                      onClick={addField}
                      disabled={form.fields.length >= 25}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs disabled:opacity-40"
                    >
                      <ListPlus className="h-3.5 w-3.5" /> Field追加
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {form.fields.map((field, index) => (
                      <div
                        key={index}
                        className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-[1fr_2fr_auto]"
                      >
                        <input
                          value={field.name}
                          onChange={(event) => updateField(index, { name: event.target.value })}
                          maxLength={256}
                          className={INPUT_CLASS_NAME}
                          placeholder="項目名"
                        />
                        <input
                          value={field.value}
                          onChange={(event) => updateField(index, { value: event.target.value })}
                          maxLength={1024}
                          className={INPUT_CLASS_NAME}
                          placeholder="値"
                        />
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-muted">
                            <input
                              type="checkbox"
                              checked={field.inline === true}
                              onChange={(event) =>
                                updateField(index, { inline: event.target.checked })
                              }
                            />
                            横並び
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                fields: form.fields.filter((_, i) => i !== index),
                              })
                            }
                            className="rounded-lg p-2 text-destructive hover:bg-destructive/5"
                            aria-label="Fieldを削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  保存後すぐ有効化
                </label>
                <label
                  className={`flex items-center gap-2 text-sm ${allowAnnouncementCrosspost ? '' : 'text-muted'}`}
                >
                  <input
                    type="checkbox"
                    checked={form.publishAnnouncement}
                    disabled={!allowAnnouncementCrosspost}
                    onChange={(event) =>
                      setForm({ ...form, publishAnnouncement: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-border"
                  />
                  Announcement ChannelでCrosspost
                </label>
              </div>
              <button
                type="submit"
                disabled={
                  busyKey === 'save' ||
                  !form.channelId ||
                  (form.recurrenceType === 'weekly' && form.weekdays.length === 0)
                }
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {busyKey === 'save' ? '保存中…' : editingId ? '更新する' : '予約を作成'}
              </button>
            </div>
            <p className="text-[11px] text-muted">
              {allowUserMentions
                ? 'ユーザーメンションは許可されています。@everyone / @here / Role mentionは使用できません。'
                : 'ユーザーメンション・@everyone・@here・Role mentionは安全のため使用できません。'}
            </p>
          </div>

          <div className="bg-background/40 p-5">
            <div className="sticky top-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Discord Preview</h3>
              </div>
              <div className="mt-3 rounded-2xl bg-[#313338] p-4 text-[#dbdee1] shadow-inner">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    H
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">Herta</span>
                      <span className="rounded bg-[#5865f2] px-1 py-0.5 text-[9px] font-bold text-white">
                        APP
                      </span>
                    </div>
                    {form.content ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{form.content}</p>
                    ) : null}
                    {form.messageFormat === 'embed' ? <EmbedPreview form={form} /> : null}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
                <p className="font-medium text-foreground">配信設定</p>
                <p className="mt-1">
                  {formatRecurrence(form)} · {form.timezone}
                </p>
                <p className="mt-1">投稿先: {formatChannelLabel(form.channelId, discordOptions)}</p>
                {form.publishAnnouncement ? <p className="mt-1">📢 Crosspost有効</p> : null}
              </div>
            </div>
          </div>
        </div>
      </form>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">予約・定期投稿</h2>
          <span className="text-xs text-muted">{schedules.length}件</span>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {schedules.length === 0 ? (
            <EmptyState text="予約投稿はまだありません。" />
          ) : (
            schedules.map((schedule) => (
              <article
                key={schedule.id}
                className="rounded-2xl border border-border bg-surface p-5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium">{schedule.title || '無題の投稿'}</h3>
                      <StatusBadge status={schedule.enabled ? 'enabled' : 'disabled'} />
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                        {schedule.messageFormat === 'embed' ? 'Embed' : '通常'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {formatScheduleItem(schedule)} · {schedule.timezone} ·{' '}
                      {formatChannelLabel(schedule.channelId, discordOptions)}
                    </p>
                  </div>
                  <CalendarClock className="h-5 w-5 shrink-0 text-muted" />
                </div>
                <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-sm text-foreground/90">
                  {schedule.content ||
                    schedule.embed?.description ||
                    schedule.embed?.title ||
                    '画像 / Embed投稿'}
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
                          {delivery.origin === 'manual' ? '手動' : '予約'}
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

      <div className="rounded-2xl border border-border bg-surface p-4 text-xs text-muted">
        <div className="flex items-center gap-2 text-foreground">
          <MessageSquareReply className="h-4 w-4" />
          <span className="font-medium">Discord内からの即時発言・返信</span>
        </div>
        <p className="mt-2">
          `/announce send` で即時お知らせ、`/say send` でBot発言、`/say reply`
          でメッセージURLへの返信ができます。 即時コマンドでは画像ファイルも直接添付できます。
        </p>
      </div>
    </div>
  );
}

function EmbedPreview({ form }: { form: DailyContentFormState }) {
  const hasEmbed =
    form.embedTitle ||
    form.embedDescription ||
    form.imageUrl ||
    form.thumbnailUrl ||
    form.footerText ||
    form.fields.some((field) => field.name || field.value);
  if (!hasEmbed)
    return (
      <p className="mt-2 text-xs text-[#949ba4]">Embedの内容を入力するとここに表示されます。</p>
    );
  return (
    <div
      className="mt-2 max-w-[520px] overflow-hidden rounded bg-[#2b2d31]"
      style={{ borderLeft: `4px solid ${validColor(form.embedColor)}` }}
    >
      <div className="p-3">
        {form.thumbnailUrl ? (
          <div
            className="float-right ml-3 h-16 w-16 rounded bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(form.thumbnailUrl).slice(1, -1)})` }}
          />
        ) : null}
        {form.embedTitle ? <p className="font-semibold text-white">{form.embedTitle}</p> : null}
        {form.embedDescription ? (
          <p className="mt-1 whitespace-pre-wrap text-sm">{form.embedDescription}</p>
        ) : null}
        {form.fields.length ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {form.fields
              .filter((field) => field.name || field.value)
              .map((field, index) => (
                <div key={index} className={field.inline ? '' : 'col-span-2'}>
                  <p className="text-xs font-semibold text-white">{field.name || 'Field'}</p>
                  <p className="whitespace-pre-wrap text-xs">{field.value || '—'}</p>
                </div>
              ))}
          </div>
        ) : null}
        {form.imageUrl ? (
          <div
            className="mt-3 aspect-video w-full rounded bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(form.imageUrl).slice(1, -1)})` }}
          />
        ) : null}
        {form.footerText ? (
          <p className="mt-3 text-[11px] text-[#949ba4]">{form.footerText}</p>
        ) : null}
      </div>
    </div>
  );
}

function toApiPayload(form: DailyContentFormState) {
  const embed: MessageStudioEmbedData | null =
    form.messageFormat === 'embed'
      ? {
          ...(form.embedTitle.trim() ? { title: form.embedTitle.trim() } : {}),
          ...(form.embedDescription.trim() ? { description: form.embedDescription.trim() } : {}),
          ...(form.embedColor.trim() ? { color: form.embedColor.trim() } : {}),
          ...(form.imageUrl.trim() ? { imageUrl: form.imageUrl.trim() } : {}),
          ...(form.thumbnailUrl.trim() ? { thumbnailUrl: form.thumbnailUrl.trim() } : {}),
          ...(form.footerText.trim() ? { footerText: form.footerText.trim() } : {}),
          ...(form.fields.some((field) => field.name.trim() && field.value.trim())
            ? {
                fields: form.fields
                  .filter((field) => field.name.trim() && field.value.trim())
                  .map((field) => ({
                    name: field.name.trim(),
                    value: field.value.trim(),
                    inline: field.inline === true,
                  })),
              }
            : {}),
        }
      : null;
  return {
    title: form.title,
    channelId: form.channelId,
    content: form.content,
    scheduleTime:
      form.recurrenceType === 'once'
        ? form.onceAt.slice(11, 16) || form.scheduleTime
        : form.scheduleTime,
    timezone: form.timezone,
    enabled: form.enabled,
    recurrenceType: form.recurrenceType,
    onceAt: form.recurrenceType === 'once' ? form.onceAt : null,
    weekdays: form.recurrenceType === 'weekly' ? form.weekdays : [],
    messageFormat: form.messageFormat,
    embed,
    publishAnnouncement: form.publishAnnouncement,
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function FormatButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick(): void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'}`}
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactElement<{ className?: string }>;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-foreground"
    >
      {cloneElement(icon, { className: 'h-3.5 w-3.5' })}
    </button>
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
  icon: ReactElement<{ className?: string }>;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-40 ${destructive ? 'border-destructive/30 text-destructive hover:bg-destructive/5' : 'border-border hover:bg-background'}`}
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
  if (status === 'failed' || status === 'skipped')
    return <TriangleAlert className="h-5 w-5 text-destructive" />;
  return <CalendarClock className="h-5 w-5 text-muted" />;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function formatChannelLabel(
  channelId: string,
  discordOptions?: GuildConfigurationOptions | null,
): string {
  if (!channelId) return '未選択';
  const channel = discordOptions?.channels.find((candidate) => candidate.id === channelId);
  return channel ? `#${channel.name}` : `#${channelId}`;
}

function formatRecurrence(form: DailyContentFormState): string {
  if (form.recurrenceType === 'once') return `1回 ${form.onceAt.replace('T', ' ')}`;
  if (form.recurrenceType === 'weekly')
    return `毎週 ${formatWeekdays(form.weekdays)} ${form.scheduleTime}`;
  return `毎日 ${form.scheduleTime}`;
}

function formatScheduleItem(schedule: DailyContentScheduleItem): string {
  if (schedule.recurrenceType === 'once')
    return schedule.onceAt ? `1回 ${formatDate(schedule.onceAt)}` : '1回予約';
  if (schedule.recurrenceType === 'weekly')
    return `毎週 ${formatWeekdays(schedule.weekdays)} ${schedule.scheduleTime}`;
  return `毎日 ${schedule.scheduleTime}`;
}

function formatWeekdays(days: readonly number[]): string {
  return (
    WEEKDAYS.filter((weekday) => days.includes(weekday.value))
      .map((weekday) => weekday.label)
      .join('・') || '曜日未選択'
  );
}

function validColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#5865F2';
}

function nextLocalDateTime(timezone: string): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return formatZonedDateTimeLocal(date, timezone);
}

function toDateTimeLocal(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nextLocalDateTime(timezone);
  return formatZonedDateTimeLocal(date, timezone);
}

function formatZonedDateTimeLocal(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const values = new Map(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}T${values.get('hour')}:${values.get('minute')}`;
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok)
    throw new Error(typeof payload.error === 'string' ? payload.error : 'リクエストに失敗しました');
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
