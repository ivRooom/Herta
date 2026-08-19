'use client';

import {
  BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
  BIRTHDAY_CARD_PRESETS,
  birthdayCardPreset,
  normalizeBirthdayCardConfig,
  type BirthdayCardConfig,
  type BirthdayCardConfigFieldKey,
} from '@herta/shared';
import { ImageIcon, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
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

  const editable = useMemo(
    () => new Set(configAccess.editableFieldKeys),
    [configAccess.editableFieldKeys],
  );
  const canEditAll = BIRTHDAY_CARD_CONFIG_FIELD_KEYS.every((key) => editable.has(key));
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const preset = birthdayCardPreset(config.birthdayCardPreset);

  function update<K extends keyof BirthdayCardConfig>(key: K, value: BirthdayCardConfig[K]) {
    if (!editable.has(key)) return;
    setConfig((current) => ({ ...current, [key]: value }));
    setStatus('未保存の変更があります');
  }

  async function save() {
    if (!dirty || pending || !canEditAll) return;
    setPending(true);
    setStatus('保存中…');
    try {
      const configPatch = Object.fromEntries(
        BIRTHDAY_CARD_CONFIG_FIELD_KEYS.map((key) => [key, config[key]]),
      );
      const response = await fetch(`/api/guilds/${guildId}/plugins/birthday-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        body: JSON.stringify({ configPatch }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; config?: Record<string, unknown> }
        | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'Birthday Cardの保存に失敗しました',
        );
      }
      const next = normalizeBirthdayCardConfig(payload?.config ?? configPatch);
      setConfig(next);
      setSaved(next);
      setStatus('Birthday Cardを保存しました');
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
            プリセットを選び、名前・Avatar・誕生日・年齢の表示と位置・サイズを調整します。実際の投稿ではDiscordの表示名とAvatar、生年から算出した年齢を使います。
          </p>
        </div>
        {!canEditAll ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">
            IAM閲覧モード
          </span>
        ) : null}
      </div>

      <div className="relative aspect-[1672/941] overflow-hidden rounded-2xl border border-border bg-background">
        <img
          src={`/birthday-card-presets/${preset.assetFile}`}
          alt={`${preset.label} Birthday Cardプリセット`}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {config.birthdayCardShowAvatar ? (
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-primary/90 font-semibold text-white"
            style={{
              left: `${config.birthdayCardAvatarX}%`,
              top: `${config.birthdayCardAvatarY}%`,
              width: `${config.birthdayCardAvatarSize}%`,
              aspectRatio: '1 / 1',
              fontSize: 'clamp(10px, 2vw, 26px)',
            }}
            aria-label="Avatarプレビュー"
          >
            HM
          </div>
        ) : null}
        {config.birthdayCardShowName ? (
          <PreviewText
            value="Herta Member"
            x={config.birthdayCardNameX}
            y={config.birthdayCardNameY}
            size={config.birthdayCardNameSize}
            color={preset.textColor}
            stroke={preset.textStroke}
          />
        ) : null}
        {config.birthdayCardShowBirthday ? (
          <PreviewText
            value="8月19日"
            x={config.birthdayCardBirthdayX}
            y={config.birthdayCardBirthdayY}
            size={config.birthdayCardBirthdaySize}
            color={preset.textColor}
            stroke={preset.textStroke}
          />
        ) : null}
        {config.birthdayCardShowAge ? (
          <PreviewText
            value="25歳"
            x={config.birthdayCardAgeX}
            y={config.birthdayCardAgeY}
            size={config.birthdayCardAgeSize}
            color={preset.textColor}
            stroke={preset.textStroke}
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border bg-background p-4">
          <h3 className="font-medium">表示内容</h3>
          <label className="text-sm">
            プリセット
            <select
              value={config.birthdayCardPreset}
              onChange={(event) =>
                update('birthdayCardPreset', event.target.value as BirthdayCardConfig['birthdayCardPreset'])
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
          <Toggle
            label="Birthday Cardを投稿する"
            checked={config.birthdayCardEnabled}
            disabled={!editable.has('birthdayCardEnabled') || pending}
            onChange={(value) => update('birthdayCardEnabled', value)}
          />
          <Toggle
            label="名前"
            checked={config.birthdayCardShowName}
            disabled={!editable.has('birthdayCardShowName') || pending}
            onChange={(value) => update('birthdayCardShowName', value)}
          />
          <Toggle
            label="Avatar"
            checked={config.birthdayCardShowAvatar}
            disabled={!editable.has('birthdayCardShowAvatar') || pending}
            onChange={(value) => update('birthdayCardShowAvatar', value)}
          />
          <Toggle
            label="誕生日"
            checked={config.birthdayCardShowBirthday}
            disabled={!editable.has('birthdayCardShowBirthday') || pending}
            onChange={(value) => update('birthdayCardShowBirthday', value)}
          />
          <Toggle
            label="年齢（生年登録時のみ）"
            checked={config.birthdayCardShowAge}
            disabled={!editable.has('birthdayCardShowAge') || pending}
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
            editable={editable}
            pending={pending}
            update={update}
          />
        </div>
      </div>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {status || (dirty ? '未保存の変更があります' : '設定は保存済みです')}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || pending || !canEditAll}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" /> {pending ? '保存中…' : 'Card設定を保存'}
        </button>
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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
  editable: ReadonlySet<string>;
  pending: boolean;
  update<K extends keyof BirthdayCardConfig>(key: K, value: BirthdayCardConfig[K]): void;
}) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <RangeControl
        label="X"
        value={x}
        min={0}
        max={100}
        disabled={!editable.has(xKey) || pending}
        onChange={(value) => update(xKey, value)}
      />
      <RangeControl
        label="Y"
        value={y}
        min={0}
        max={100}
        disabled={!editable.has(yKey) || pending}
        onChange={(value) => update(yKey, value)}
      />
      <RangeControl
        label="サイズ"
        value={size}
        min={minSize}
        max={maxSize}
        disabled={!editable.has(sizeKey) || pending}
        onChange={(value) => update(sizeKey, value)}
      />
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

function PreviewText({
  value,
  x,
  y,
  size,
  color,
  stroke,
}: {
  value: string;
  x: number;
  y: number;
  size: number;
  color: string;
  stroke: string;
}) {
  return (
    <span
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-bold"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        color,
        WebkitTextStroke: `clamp(1px, 0.15vw, 3px) ${stroke}`,
        paintOrder: 'stroke fill',
        fontSize: `clamp(10px, ${Math.max(1, size / 28)}vw, ${Math.round(size / 1.5)}px)`,
      }}
    >
      {value}
    </span>
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
