'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, ImageIcon, LoaderCircle, Radio, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import {
  BOT_ACTIVITY_TYPES,
  BOT_PRESENCE_STATUSES,
  DEFAULT_BOT_PRESENCE_CONFIG,
  type BotActivityType,
  type BotPresenceConfig,
  type BotPresenceStatus,
} from '@herta/shared';
import { BOT_AVATAR_MAX_BYTES, BOT_AVATAR_MIME_TYPES } from '@/lib/bot-profile-input';

interface BotGuildProfile {
  userId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  guildAvatar: boolean;
}

export function BotProfileSettings({
  guildId,
  guildName,
  canManageGlobalPresence,
}: {
  guildId: string;
  guildName: string;
  canManageGlobalPresence: boolean;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <GuildProfileCard guildId={guildId} guildName={guildName} />
      {canManageGlobalPresence ? (
        <GlobalPresenceCard />
      ) : (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                Global Presence
              </p>
              <h2 className="mt-1 text-lg font-semibold">Bot全体のPresence</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                PresenceはすべてのDiscordサーバーへ影響するため、Herta管理者だけが変更できます。
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function GuildProfileCard({ guildId, guildName }: { guildId: string; guildName: string }) {
  const [profile, setProfile] = useState<BotGuildProfile | null>(null);
  const [nickname, setNickname] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarReset, setAvatarReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function clearAvatarInput() {
    setAvatarFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/guilds/${guildId}/bot-profile`, { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json()) as { profile?: BotGuildProfile; error?: string };
        if (!response.ok || !body.profile)
          throw new Error(body.error || 'Botプロフィールを取得できません');
        if (cancelled) return;
        setProfile(body.profile);
        setNickname(body.profile.nickname ?? '');
      })
      .catch((fetchError) => {
        if (!cancelled) setError(toMessage(fetchError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [guildId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = new FormData();
      data.set('nickname', nickname);
      data.set('avatarAction', avatarReset ? 'reset' : avatarFile ? 'replace' : 'keep');
      if (avatarFile && !avatarReset) data.set('avatar', avatarFile);

      const response = await fetch(`/api/guilds/${guildId}/bot-profile`, {
        method: 'PATCH',
        body: data,
      });
      const body = (await response.json()) as { profile?: BotGuildProfile; error?: string };
      if (!response.ok || !body.profile)
        throw new Error(body.error || 'Botプロフィールを保存できません');

      setProfile(body.profile);
      setNickname(body.profile.nickname ?? '');
      clearAvatarInput();
      setAvatarReset(false);
      setMessage('DiscordへBotプロフィールを反映しました');
    } catch (saveError) {
      setError(toMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarChange(file: File | null) {
    setError(null);
    if (!file) {
      clearAvatarInput();
      return;
    }
    if (!BOT_AVATAR_MIME_TYPES.includes(file.type as (typeof BOT_AVATAR_MIME_TYPES)[number])) {
      setError('AvatarはPNG / JPEG / GIFを選択してください');
      clearAvatarInput();
      return;
    }
    if (file.size <= 0 || file.size > BOT_AVATAR_MAX_BYTES) {
      setError('Avatarは1MiB以下にしてください');
      clearAvatarInput();
      return;
    }
    setAvatarFile(file);
    setAvatarReset(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Server Profile
          </p>
          <h2 className="mt-1 text-lg font-semibold">{guildName}での表示</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            このNicknameとAvatarは選択中のDiscordサーバーだけに反映されます。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> 読み込み中...
        </div>
      ) : profile ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-background p-4">
            {profile.avatarUrl && !avatarReset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={`${profile.nickname ?? profile.username}の現在のBot Avatar`}
                className="h-16 w-16 shrink-0 rounded-2xl border border-border object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary">
                H
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{profile.nickname ?? profile.username}</p>
              <p className="mt-1 text-xs text-muted">
                {avatarReset
                  ? '保存時にサーバー固有Avatarを解除します'
                  : avatarFile
                    ? `${avatarFile.name} に変更予定`
                    : profile.guildAvatar
                      ? 'サーバー固有Avatarを使用中'
                      : 'Bot共通Avatarを使用中'}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="bot-nickname" className="text-sm font-semibold">
              Nickname
            </label>
            <input
              id="bot-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value.slice(0, 32))}
              maxLength={32}
              placeholder={profile.username}
              className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <p className="mt-1.5 text-xs text-muted">空欄でサーバー固有Nicknameを解除します。</p>
          </div>

          <div>
            <label htmlFor="bot-avatar" className="text-sm font-semibold">
              Server Avatar
            </label>
            <label
              htmlFor="bot-avatar"
              className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm font-medium text-muted transition-colors hover:border-primary/40 hover:text-foreground focus-within:ring-2 focus-within:ring-ring"
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
              {avatarFile ? avatarFile.name : 'PNG / JPEG / GIFを選択'}
              <input
                id="bot-avatar"
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                onChange={(event) => handleAvatarChange(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <p className="mt-1.5 text-xs text-muted">
              上限1MiB。画像内容もサーバー側で再検証します。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                clearAvatarInput();
                setAvatarReset(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Server Avatarを解除
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {saving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Discordへ保存
            </button>
          </div>

          <Feedback message={message} error={error} />
        </form>
      ) : (
        <Feedback message={message} error={error ?? 'Botプロフィールを取得できませんでした'} />
      )}
    </section>
  );
}

function GlobalPresenceCard() {
  const [config, setConfig] = useState<BotPresenceConfig>({ ...DEFAULT_BOT_PRESENCE_CONFIG });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [persistenceAvailable, setPersistenceAvailable] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/bot/presence', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json()) as {
          config?: BotPresenceConfig;
          persistenceAvailable?: boolean;
          error?: string;
        };
        if (!response.ok || !body.config) throw new Error(body.error || 'Presenceを取得できません');
        if (cancelled) return;
        setConfig(body.config);
        setPersistenceAvailable(body.persistenceAvailable ?? true);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(toMessage(fetchError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/bot/presence', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = (await response.json()) as {
        config?: BotPresenceConfig;
        notificationDelivered?: boolean;
        error?: string;
      };
      if (!response.ok || !body.config) throw new Error(body.error || 'Presenceを保存できません');
      setConfig(body.config);
      setPersistenceAvailable(true);
      setMessage(
        body.notificationDelivered
          ? 'Presenceを保存し、起動中のBotへ反映通知を送信しました'
          : 'Presenceを保存しました。Bot起動時に自動適用されます',
      );
    } catch (saveError) {
      setError(toMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-400">
          <Radio className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            Global Presence
          </p>
          <h2 className="mt-1 text-lg font-semibold">Bot全体のステータス</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            変更はHertaが参加しているすべてのサーバーに表示されます。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> 読み込み中...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {!persistenceAvailable ? (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">
              設定データベースへ接続できないため現在はデフォルト表示です。接続復旧後に保存してください。
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="bot-presence-status"
              label="Status"
              value={config.status}
              options={BOT_PRESENCE_STATUSES.map((value) => ({
                value,
                label: presenceStatusLabel(value),
              }))}
              onChange={(value) =>
                setConfig((current) => ({ ...current, status: value as BotPresenceStatus }))
              }
            />
            <SelectField
              id="bot-activity-type"
              label="Activity Type"
              value={config.activityType}
              options={BOT_ACTIVITY_TYPES.map((value) => ({
                value,
                label: activityTypeLabel(value),
              }))}
              onChange={(value) =>
                setConfig((current) => ({ ...current, activityType: value as BotActivityType }))
              }
            />
          </div>

          <div>
            <label htmlFor="bot-activity-text" className="text-sm font-semibold">
              Activity
            </label>
            <input
              id="bot-activity-text"
              value={config.activityText}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  activityText: event.target.value.slice(0, 128),
                }))
              }
              required
              maxLength={128}
              placeholder="Herta"
              className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <button
            type="submit"
            disabled={saving || config.activityText.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {saving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Presenceを保存
          </button>

          <Feedback message={message} error={error} />
        </form>
      )}
    </section>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Feedback({ message, error }: { message: string | null; error: string | null }) {
  return (
    <>
      {error ? (
        <p
          className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </>
  );
}

function presenceStatusLabel(status: BotPresenceStatus): string {
  return {
    online: 'Online',
    idle: 'Idle',
    dnd: 'Do Not Disturb',
    invisible: 'Invisible（オフライン表示）',
  }[status];
}

function activityTypeLabel(type: BotActivityType): string {
  return {
    playing: 'Playing',
    listening: 'Listening',
    watching: 'Watching',
    competing: 'Competing',
  }[type];
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '処理に失敗しました';
}
