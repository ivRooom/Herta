'use client';

import {
  BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
  BIRTHDAY_CARD_PRESETS,
  normalizeBirthdayCardConfig,
  type BirthdayCardConfig,
  type BirthdayCardConfigFieldKey,
} from '@herta/shared';
import { ImageIcon, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  BirthdayCardLivePreview,
  type BirthdayCardPositionXKey,
  type BirthdayCardPositionYKey,
} from '@/components/birthday-card-live-preview';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';

const SAVE_TIMEOUT_MS = 15_000;

export function BirthdayCardEditor({
  guildId,
  initialConfig,
  configAccess,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
  configAccess: PluginConfigStudioAccess;
}) {
  const initial = useMemo(() => normalizeBirthdayCardConfig(initialConfig), [initialConfig]);
  const [config, setConfig] = useState<BirthdayCardConfig>(initial);
  const [saved, setSaved] = useState<BirthdayCardConfig>(initial);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');

  const readable = useMemo(
    () => new Set(configAccess.readableFieldKeys),
    [configAccess.readableFieldKeys],
  );
  const editable = useMemo(
    () => new Set(configAccess.editableFieldKeys),
    [configAccess.editableFieldKeys],
  );
  const dirtyFieldKeys = BIRTHDAY_CARD_CONFIG_FIELD_KEYS.filter(
    (key) => editable.has(key) && !Object.is(config[key], saved[key]),
  );
  const dirty = dirtyFieldKeys.length > 0;
  const hasEditableFields = BIRTHDAY_CARD_CONFIG_FIELD_KEYS.some((key) => editable.has(key));

  function update<K extends keyof BirthdayCardConfig>(key: K, value: BirthdayCardConfig[K]) {
    if (!editable.has(key)) return;
    setConfig((current) => ({ ...current, [key]: value }));
    setStatus('未保存の変更があります');
  }

  function updatePosition(
    xKey: BirthdayCardPositionXKey,
    yKey: BirthdayCardPositionYKey,
    x: number,
    y: number,
  ) {
    if (!editable.has(xKey) && !editable.has(yKey)) return;
    setConfig((current) => {
      const next = { ...current };
      if (editable.has(xKey)) next[xKey] = x;
      if (editable.has(yKey)) next[yKey] = y;
      return next;
    });
    setStatus('未保存の変更があります');
  }

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setStatus('保存中…');
    try {
      const configPatch = Object.fromEntries(dirtyFieldKeys.map((key) => [key, config[key]]));
      const response = await fetch(`/api/guilds/${guildId}/plugins/birthday-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify({ configPatch }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        config?: Record<string, unknown>;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'Birthday Cardの保存に失敗しました',
        );
      }

      const next = normalizeBirthdayCardConfig({
        ...config,
        ...(payload?.config ?? {}),
        ...configPatch,
      });
      setConfig(next);
      setSaved(next);
      setStatus('許可されたBirthday Card設定を保存しました');
    } catch (error) {
      setStatus(
        isTimeoutError(error)
          ? '保存がタイムアウトしました。通信状態を確認して再実行してください。'
          : error instanceof Error
            ? error.message
            : 'Birthday Cardの保存に失敗しました',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">Birthday Card Studio</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            プリセットを選び、名前・Avatar・誕生日・年齢の表示と位置・サイズをライブプレビューで調整します。実際の投稿ではDiscordの表示名とAvatar、生年から算出した年齢を使います。
          </p>
        </div>
        {!hasEditableFields ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
            IAM閲覧モード
          </span>
        ) : configAccess.editableFieldKeys.length < configAccess.readableFieldKeys.length ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
            IAM部分編集
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.8fr)] xl:items-start">
        <div className="xl:sticky xl:top-20">
          <BirthdayCardLivePreview
            config={config}
            readable={readable}
            editable={editable}
            pending={pending}
            onPositionChange={updatePosition}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <div className="space-y-4 rounded-xl border border-border bg-background p-4">
            <h3 className="font-medium">表示内容</h3>
            {readable.has('birthdayCardPreset') ? (
              <label className="text-sm">
                プリセット
                <select
                  value={config.birthdayCardPreset}
                  onChange={(event) =>
                    update(
                      'birthdayCardPreset',
                      event.target.value as BirthdayCardConfig['birthdayCardPreset'],
                    )
                  }
                  disabled={!editable.has('birthdayCardPreset') || pending}
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 disabled:opacity-50"
                >
                  {BIRTHDAY_CARD_PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ToggleIfReadable
              field="birthdayCardEnabled"
              label="Birthday Cardを投稿する"
              checked={config.birthdayCardEnabled}
              readable={readable}
              editable={editable}
              pending={pending}
              onChange={(value) => update('birthdayCardEnabled', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowName"
              label="名前"
              checked={config.birthdayCardShowName}
              readable={readable}
              editable={editable}
              pending={pending}
              onChange={(value) => update('birthdayCardShowName', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowAvatar"
              label="Avatar"
              checked={config.birthdayCardShowAvatar}
              readable={readable}
              editable={editable}
              pending={pending}
              onChange={(value) => update('birthdayCardShowAvatar', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowBirthday"
              label="誕生日"
              checked={config.birthdayCardShowBirthday}
              readable={readable}
              editable={editable}
              pending={pending}
              onChange={(value) => update('birthdayCardShowBirthday', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowAge"
              label="年齢（生年登録時のみ）"
              checked={config.birthdayCardShowAge}
              readable={readable}
              editable={editable}
              pending={pending}
              onChange={(value) => update('birthdayCardShowAge', value)}
            />
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-background p-4">
            <h3 className="font-medium">レイアウト</h3>
            <PositionControls
              label="Avatar"
              xKey="birthdayCardAvatarX"
              yKey="birthdayCardAvatarY"
              sizeKey="birthdayCardAvatarSize"
              x={config.birthdayCardAvatarX}
              y={config.birthdayCardAvatarY}
              size={config.birthdayCardAvatarSize}
              minSize={6}
              maxSize={30}
              readable={readable}
              editable={editable}
              pending={pending}
              update={update}
            />
            <PositionControls
              label="名前"
              xKey="birthdayCardNameX"
              yKey="birthdayCardNameY"
              sizeKey="birthdayCardNameSize"
              x={config.birthdayCardNameX}
              y={config.birthdayCardNameY}
              size={config.birthdayCardNameSize}
              minSize={20}
              maxSize={96}
              readable={readable}
              editable={editable}
              pending={pending}
              update={update}
            />
            <PositionControls
              label="誕生日"
              xKey="birthdayCardBirthdayX"
              yKey="birthdayCardBirthdayY"
              sizeKey="birthdayCardBirthdaySize"
              x={config.birthdayCardBirthdayX}
              y={config.birthdayCardBirthdayY}
              size={config.birthdayCardBirthdaySize}
              minSize={16}
              maxSize={72}
              readable={readable}
              editable={editable}
              pending={pending}
              update={update}
            />
            <PositionControls
              label="年齢"
              xKey="birthdayCardAgeX"
              yKey="birthdayCardAgeY"
              sizeKey="birthdayCardAgeSize"
              x={config.birthdayCardAgeX}
              y={config.birthdayCardAgeY}
              size={config.birthdayCardAgeSize}
              minSize={16}
              maxSize={72}
              readable={readable}
              editable={editable}
              pending={pending}
              update={update}
            />
          </div>
        </div>
      </div>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {status || (dirty ? '未保存の変更があります' : '設定は保存済みです')}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />{' '}
          {pending ? '保存中…' : '許可されたCard設定を保存'}
        </button>
      </div>
    </section>
  );
}

function ToggleIfReadable({
  field,
  label,
  checked,
  readable,
  editable,
  pending,
  onChange,
}: {
  field: BirthdayCardConfigFieldKey;
  label: string;
  checked: boolean;
  readable: ReadonlySet<string>;
  editable: ReadonlySet<string>;
  pending: boolean;
  onChange(value: boolean): void;
}) {
  if (!readable.has(field)) return null;
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={!editable.has(field) || pending}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary disabled:opacity-50"
      />
    </label>
  );
}

type NumericCardKey = Exclude<
  BirthdayCardConfigFieldKey,
  | 'birthdayCardEnabled'
  | 'birthdayCardPreset'
  | 'birthdayCardShowName'
  | 'birthdayCardShowAvatar'
  | 'birthdayCardShowBirthday'
  | 'birthdayCardShowAge'
>;

function PositionControls({
  label,
  xKey,
  yKey,
  sizeKey,
  x,
  y,
  size,
  minSize,
  maxSize,
  readable,
  editable,
  pending,
  update,
}: {
  label: string;
  xKey: NumericCardKey;
  yKey: NumericCardKey;
  sizeKey: NumericCardKey;
  x: number;
  y: number;
  size: number;
  minSize: number;
  maxSize: number;
  readable: ReadonlySet<string>;
  editable: ReadonlySet<string>;
  pending: boolean;
  update<K extends keyof BirthdayCardConfig>(key: K, value: BirthdayCardConfig[K]): void;
}) {
  if (![xKey, yKey, sizeKey].some((key) => readable.has(key))) return null;
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {readable.has(xKey) ? (
        <RangeControl
          label="X"
          value={x}
          min={0}
          max={100}
          disabled={!editable.has(xKey) || pending}
          onChange={(value) => update(xKey, value)}
        />
      ) : null}
      {readable.has(yKey) ? (
        <RangeControl
          label="Y"
          value={y}
          min={0}
          max={100}
          disabled={!editable.has(yKey) || pending}
          onChange={(value) => update(yKey, value)}
        />
      ) : null}
      {readable.has(sizeKey) ? (
        <RangeControl
          label="サイズ"
          value={size}
          min={minSize}
          max={maxSize}
          disabled={!editable.has(sizeKey) || pending}
          onChange={(value) => update(sizeKey, value)}
        />
      ) : null}
    </fieldset>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${label} ${value}`}
      />
      <span className="text-right tabular-nums">{Math.round(value)}</span>
    </label>
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
