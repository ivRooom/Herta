'use client';

import {
  BIRTHDAY_CARD_BACKGROUND_MAX_BYTES,
  BIRTHDAY_CARD_CONFIG_FIELD_KEYS,
  BIRTHDAY_CARD_PRESETS,
  birthdayCardPreset,
  normalizeBirthdayCardConfig,
  type BirthdayCardConfig,
  type BirthdayCardConfigFieldKey,
} from '@herta/shared';
import { ImageIcon, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  BirthdayCardAssetLibrary,
  type BirthdayCardAssetMetadata,
} from '@/components/birthday-card-asset-library';
import {
  BirthdayCardLivePreview,
  type BirthdayCardPositionXKey,
  type BirthdayCardPositionYKey,
} from '@/components/birthday-card-live-preview';
import { DiscordChannelPicker } from '@/components/discord-entity-picker';
import type { GuildChannelOption } from '@/lib/bot-guild-options';
import {
  birthdayCardDirtyFieldKeys,
  restoreBirthdayCardEditableConfig,
} from '@/lib/birthday-card-editor-state';
import { renderBirthdayCardPreviewPng } from '@/lib/birthday-card-preview-export';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';

const SAVE_TIMEOUT_MS = 15_000;
const BACKGROUND_TIMEOUT_MS = 30_000;
const ASSET_TIMEOUT_MS = 30_000;
const TEST_SEND_TIMEOUT_MS = 30_000;
const EMPTY_EDITABLE_FIELDS: ReadonlySet<string> = new Set<string>();
const ALLOWED_BACKGROUND_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type PreviewMode = 'draft' | 'saved';

export interface BirthdayCardBackgroundMetadata {
  contentType: string;
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  updatedAt: string;
}

export function BirthdayCardEditor({
  guildId,
  initialConfig,
  configAccess,
  initialBackground,
  initialAssets,
  canReadBackground,
  canWriteBackground,
  canReadAssets,
  canWriteAssets,
  canManagePresets,
  canTestSend,
  channelOptions,
}: {
  guildId: string;
  initialConfig: Record<string, unknown>;
  configAccess: PluginConfigStudioAccess;
  initialBackground: BirthdayCardBackgroundMetadata | null;
  initialAssets: BirthdayCardAssetMetadata[];
  canReadBackground: boolean;
  canWriteBackground: boolean;
  canReadAssets: boolean;
  canWriteAssets: boolean;
  canManagePresets: boolean;
  canTestSend: boolean;
  channelOptions: GuildChannelOption[];
}) {
  const initial = useMemo(() => normalizeBirthdayCardConfig(initialConfig), [initialConfig]);
  const [config, setConfig] = useState<BirthdayCardConfig>(initial);
  const [saved, setSaved] = useState<BirthdayCardConfig>(initial);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('draft');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [background, setBackground] = useState(initialBackground);
  const [backgroundPending, setBackgroundPending] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState('');
  const [assets, setAssets] = useState(initialAssets);
  const [assetPending, setAssetPending] = useState(false);
  const [assetStatus, setAssetStatus] = useState('');
  const [testChannelId, setTestChannelId] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [testStatus, setTestStatus] = useState('');

  const readable = useMemo(
    () => new Set(configAccess.readableFieldKeys),
    [configAccess.readableFieldKeys],
  );
  const editable = useMemo(
    () => new Set(configAccess.editableFieldKeys),
    [configAccess.editableFieldKeys],
  );
  const dirtyFieldKeys = birthdayCardDirtyFieldKeys(config, saved, editable);
  const dirty = dirtyFieldKeys.length > 0;
  const hasEditableFields = BIRTHDAY_CARD_CONFIG_FIELD_KEYS.some((key) => editable.has(key));
  const previewConfig = previewMode === 'saved' ? saved : config;
  const previewEditable = previewMode === 'saved' ? EMPTY_EDITABLE_FIELDS : editable;
  const interactionPending = pending || backgroundPending || assetPending || testPending;
  const preset = birthdayCardPreset(previewConfig.birthdayCardPreset);
  const canReadBackgroundSource = readable.has('birthdayCardBackgroundSource');
  const canReadAssetId = readable.has('birthdayCardAssetId');
  const canReadPreset = readable.has('birthdayCardPreset');
  const canUseAsset =
    canWriteAssets &&
    editable.has('birthdayCardBackgroundSource') &&
    editable.has('birthdayCardAssetId');
  const selectedPreviewAsset =
    canReadAssetId && previewConfig.birthdayCardAssetId
      ? (assets.find((asset) => asset.id === previewConfig.birthdayCardAssetId) ?? null)
      : null;
  const selectedDraftAsset =
    config.birthdayCardBackgroundSource === 'asset' && config.birthdayCardAssetId
      ? (assets.find((asset) => asset.id === config.birthdayCardAssetId) ?? null)
      : null;
  const persistedActiveAssetId =
    saved.birthdayCardBackgroundSource === 'asset' ? (saved.birthdayCardAssetId ?? null) : null;
  const backgroundUrl = resolveBackgroundUrl({
    guildId,
    config: previewConfig,
    canReadBackgroundSource,
    canReadBackground,
    canReadAssets,
    canReadAssetId,
    canReadPreset,
    background,
    asset: selectedPreviewAsset,
    presetAssetFile: preset.assetFile,
  });
  const backgroundLabel = !canReadBackgroundSource
    ? '背景画像'
    : previewConfig.birthdayCardBackgroundSource === 'asset'
      ? selectedPreviewAsset?.name || '画像ライブラリ'
      : previewConfig.birthdayCardBackgroundSource === 'custom'
        ? background?.fileName || '旧カスタム背景'
        : canReadPreset
          ? preset.label
          : '背景プリセット';

  function update<K extends keyof BirthdayCardConfig>(key: K, value: BirthdayCardConfig[K]) {
    if (!editable.has(key)) return;
    setConfig((current) => ({ ...current, [key]: value }));
    setPreviewMode('draft');
    setStatus('未保存の変更があります');
  }

  function useAsset(asset: BirthdayCardAssetMetadata) {
    if (!canUseAsset) {
      setAssetStatus('この画像を使用するBirthday Card設定IAM権限がありません');
      return;
    }
    setConfig((current) => ({
      ...current,
      birthdayCardBackgroundSource: 'asset',
      birthdayCardAssetId: asset.id,
    }));
    setPreviewMode('draft');
    setStatus('未保存の変更があります');
    setAssetStatus(`${asset.name} を変更中の背景として選択しました。Card設定を保存してください。`);
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
    setPreviewMode('draft');
    setStatus('未保存の変更があります');
  }

  function resetChanges() {
    if (!dirty || interactionPending) return;
    if (!window.confirm('未保存のBirthday Card変更を保存済み設定へ戻しますか？')) return;

    setConfig((current) => restoreBirthdayCardEditableConfig(current, saved, editable));
    setPreviewMode('draft');
    setStatus('未保存の変更を保存済み設定へ戻しました');
  }

  async function save() {
    if (!dirty || interactionPending) return;
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
      setPreviewMode('draft');
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

  async function uploadAsset(file: File) {
    if (assetPending || interactionPending) return;
    if (!canWriteAssets) {
      setAssetStatus('画像ライブラリへ登録するIAM権限がありません');
      return;
    }
    if (!ALLOWED_BACKGROUND_TYPES.has(file.type)) {
      setAssetStatus('PNG / JPEG / WebPを選択してください');
      return;
    }
    if (file.size <= 0 || file.size > BIRTHDAY_CARD_BACKGROUND_MAX_BYTES) {
      setAssetStatus('背景画像は5 MiB以下にしてください');
      return;
    }

    setAssetPending(true);
    setAssetStatus('画像ライブラリへ登録中…');
    try {
      const form = new FormData();
      form.set('background', file, file.name);
      const response = await fetch(`/api/guilds/${guildId}/birthday/card-assets`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        asset?: BirthdayCardAssetMetadata;
      } | null;
      if (!response.ok || !payload?.asset) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : '画像ライブラリへの登録に失敗しました',
        );
      }

      setAssets((current) => [
        payload.asset!,
        ...current.filter((item) => item.id !== payload.asset!.id),
      ]);
      if (canUseAsset) {
        useAsset(payload.asset);
        setAssetStatus(
          `${payload.asset.name}（${payload.asset.width}×${payload.asset.height}）を登録し、変更中の背景として選択しました。必要ならPresetに追加できます。`,
        );
      } else {
        setAssetStatus(`${payload.asset.name} を画像ライブラリへ登録しました。`);
      }
    } catch (error) {
      setAssetStatus(
        isTimeoutError(error)
          ? '画像の登録がタイムアウトしました'
          : error instanceof Error
            ? error.message
            : '画像ライブラリへの登録に失敗しました',
      );
    } finally {
      setAssetPending(false);
    }
  }

  async function renameAsset(asset: BirthdayCardAssetMetadata) {
    if (!canWriteAssets || interactionPending) return;
    const nextName = window.prompt('画像名を入力してください', asset.name)?.trim();
    if (!nextName || nextName === asset.name) return;
    await patchAsset(asset, { name: nextName }, '画像名を変更しました');
  }

  async function toggleAssetPreset(asset: BirthdayCardAssetMetadata) {
    if (!canManagePresets || interactionPending) return;
    await patchAsset(
      asset,
      { isPreset: !asset.isPreset },
      asset.isPreset ? 'Guild Presetから解除しました' : 'Guild Presetへ追加しました',
    );
  }

  async function patchAsset(
    asset: BirthdayCardAssetMetadata,
    patch: { name?: string; isPreset?: boolean },
    successMessage: string,
  ) {
    setAssetPending(true);
    setAssetStatus('画像情報を更新中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday/card-assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
        body: JSON.stringify(patch),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        asset?: BirthdayCardAssetMetadata;
      } | null;
      if (!response.ok || !payload?.asset) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '画像情報の更新に失敗しました',
        );
      }
      setAssets((current) =>
        [...current.map((item) => (item.id === asset.id ? payload.asset! : item))].sort(
          (a, b) =>
            Number(b.isPreset) - Number(a.isPreset) || b.updatedAt.localeCompare(a.updatedAt),
        ),
      );
      setAssetStatus(`${payload.asset.name}: ${successMessage}`);
    } catch (error) {
      setAssetStatus(
        isTimeoutError(error)
          ? '画像情報の更新がタイムアウトしました'
          : error instanceof Error
            ? error.message
            : '画像情報の更新に失敗しました',
      );
    } finally {
      setAssetPending(false);
    }
  }

  async function deleteAsset(asset: BirthdayCardAssetMetadata) {
    if (
      !canWriteAssets ||
      interactionPending ||
      (saved.birthdayCardBackgroundSource === 'asset' && asset.id === saved.birthdayCardAssetId)
    )
      return;
    if (!window.confirm(`${asset.name} を画像ライブラリから削除しますか？`)) return;
    setAssetPending(true);
    setAssetStatus('画像を削除中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday/card-assets/${asset.id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        deleted?: boolean;
      } | null;
      if (!response.ok || !payload?.deleted) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '画像の削除に失敗しました',
        );
      }
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      setAssetStatus(`${asset.name} を画像ライブラリから削除しました`);
    } catch (error) {
      setAssetStatus(
        isTimeoutError(error)
          ? '画像の削除がタイムアウトしました'
          : error instanceof Error
            ? error.message
            : '画像の削除に失敗しました',
      );
    } finally {
      setAssetPending(false);
    }
  }

  async function deleteBackground() {
    if (!background || !canWriteBackground || interactionPending) return;
    if (!window.confirm('旧Guild専用Birthday Card背景を削除しますか？')) return;
    setBackgroundPending(true);
    setBackgroundStatus('旧カスタム背景を削除中…');
    try {
      const response = await fetch(`/api/guilds/${guildId}/birthday/card-background`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        deleted?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : '旧カスタム背景の削除に失敗しました',
        );
      }
      setBackground(null);
      const resetSource =
        config.birthdayCardBackgroundSource === 'custom' &&
        editable.has('birthdayCardBackgroundSource');
      if (resetSource) update('birthdayCardBackgroundSource', 'preset');
      setBackgroundStatus(
        resetSource
          ? '旧カスタム背景を削除し、背景ソースを組み込みプリセットへ戻しました。Card設定も保存してください。'
          : '旧カスタム背景を削除しました。',
      );
    } catch (error) {
      setBackgroundStatus(
        isTimeoutError(error)
          ? '旧カスタム背景の削除がタイムアウトしました'
          : error instanceof Error
            ? error.message
            : '旧カスタム背景の削除に失敗しました',
      );
    } finally {
      setBackgroundPending(false);
    }
  }

  async function testSend() {
    if (!canTestSend || interactionPending) return;
    if (!testChannelId) {
      setTestStatus('テスト送信先Channelを選択してください');
      return;
    }
    if (!backgroundUrl) {
      setTestStatus('テスト送信できる背景画像がありません');
      return;
    }

    setTestPending(true);
    setTestStatus('ライブプレビューをPNG化してDiscordへ送信中…');
    try {
      const blob = await renderBirthdayCardPreviewPng(previewConfig, backgroundUrl);
      const form = new FormData();
      form.set('channelId', testChannelId);
      form.set('image', blob, 'birthday-card-preview.png');
      const response = await fetch(`/api/guilds/${guildId}/birthday/card-test`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TEST_SEND_TIMEOUT_MS),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        messageId?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Birthday Cardのテスト送信に失敗しました',
        );
      }
      setTestStatus('Birthday Cardのテスト画像をDiscordへ送信しました');
    } catch (error) {
      setTestStatus(
        isTimeoutError(error)
          ? 'テスト送信がタイムアウトしました'
          : error instanceof Error
            ? error.message
            : 'Birthday Cardのテスト送信に失敗しました',
      );
    } finally {
      setTestPending(false);
    }
  }

  const presetAssets = assets.filter((asset) => asset.isPreset);
  const libraryAssets = assets.filter((asset) => !asset.isPreset);

  return (
    <section className="space-y-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">Birthday Card Studio</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            組み込みPresetまたはGuildの画像ライブラリを背景にし、名前・Avatar・誕生日・年齢の表示と位置・サイズをライブプレビューで調整します。画像は先にライブラリへ登録し、必要なものだけGuild
            Presetとして整理できます。
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
        <div className="space-y-3 xl:sticky xl:top-20">
          {dirty ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">プレビュー比較</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {dirtyFieldKeys.length}項目の未保存変更があります
                </p>
              </div>
              <div
                role="group"
                aria-label="Birthday Cardプレビュー表示"
                className="inline-flex rounded-lg border border-border bg-surface p-1"
              >
                <button
                  type="button"
                  aria-pressed={previewMode === 'draft'}
                  onClick={() => setPreviewMode('draft')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    previewMode === 'draft'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  変更中
                </button>
                <button
                  type="button"
                  aria-pressed={previewMode === 'saved'}
                  onClick={() => setPreviewMode('saved')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    previewMode === 'saved'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  保存済み
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted">
              現在のプレビューは保存済み設定と一致しています。
            </div>
          )}

          <BirthdayCardLivePreview
            config={previewConfig}
            readable={readable}
            editable={previewEditable}
            pending={interactionPending}
            backgroundUrl={backgroundUrl}
            backgroundLabel={backgroundLabel}
            onPositionChange={updatePosition}
            onSizeChange={(sizeKey, size) => update(sizeKey, size)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <div className="space-y-4 rounded-xl border border-border bg-background p-4">
            <h3 className="font-medium">表示内容</h3>
            {readable.has('birthdayCardBackgroundSource') ? (
              <label className="text-sm">
                背景ソース
                <select
                  value={config.birthdayCardBackgroundSource}
                  onChange={(event) =>
                    update(
                      'birthdayCardBackgroundSource',
                      event.target.value as BirthdayCardConfig['birthdayCardBackgroundSource'],
                    )
                  }
                  disabled={!editable.has('birthdayCardBackgroundSource') || interactionPending}
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 disabled:opacity-50"
                >
                  <option value="preset">組み込みプリセット</option>
                  <option
                    value="asset"
                    disabled={
                      !canWriteAssets ||
                      !canReadAssets ||
                      !canReadAssetId ||
                      !config.birthdayCardAssetId
                    }
                  >
                    画像ライブラリ
                  </option>
                  {background ? <option value="custom">旧Guild専用アップロード画像</option> : null}
                </select>
              </label>
            ) : null}

            {canReadAssetId && canReadAssets ? (
              <label className="text-sm">
                ライブラリ画像
                <select
                  value={config.birthdayCardAssetId ?? ''}
                  onChange={(event) => {
                    const asset = assets.find((item) => item.id === event.target.value);
                    if (asset) useAsset(asset);
                  }}
                  disabled={!canUseAsset || interactionPending || assets.length === 0}
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 disabled:opacity-50"
                >
                  <option value="">画像を選択</option>
                  {presetAssets.length > 0 ? (
                    <optgroup label="Guild Preset">
                      {presetAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {libraryAssets.length > 0 ? (
                    <optgroup label="画像ライブラリ">
                      {libraryAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            ) : null}

            {readable.has('birthdayCardPreset') ? (
              <label className="text-sm">
                {config.birthdayCardBackgroundSource === 'preset'
                  ? '組み込みプリセット'
                  : 'テキスト配色プリセット'}
                <select
                  value={config.birthdayCardPreset}
                  onChange={(event) =>
                    update(
                      'birthdayCardPreset',
                      event.target.value as BirthdayCardConfig['birthdayCardPreset'],
                    )
                  }
                  disabled={!editable.has('birthdayCardPreset') || interactionPending}
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
              pending={interactionPending}
              onChange={(value) => update('birthdayCardEnabled', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowName"
              label="名前"
              checked={config.birthdayCardShowName}
              readable={readable}
              editable={editable}
              pending={interactionPending}
              onChange={(value) => update('birthdayCardShowName', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowAvatar"
              label="Avatar"
              checked={config.birthdayCardShowAvatar}
              readable={readable}
              editable={editable}
              pending={interactionPending}
              onChange={(value) => update('birthdayCardShowAvatar', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowBirthday"
              label="誕生日"
              checked={config.birthdayCardShowBirthday}
              readable={readable}
              editable={editable}
              pending={interactionPending}
              onChange={(value) => update('birthdayCardShowBirthday', value)}
            />
            <ToggleIfReadable
              field="birthdayCardShowAge"
              label="年齢（生年登録時のみ）"
              checked={config.birthdayCardShowAge}
              readable={readable}
              editable={editable}
              pending={interactionPending}
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
              pending={interactionPending}
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
              pending={interactionPending}
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
              pending={interactionPending}
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
              pending={interactionPending}
              update={update}
            />
          </div>
        </div>
      </div>

      <BirthdayCardAssetLibrary
        assets={assets}
        selectedAssetId={selectedDraftAsset?.id ?? null}
        protectedAssetId={persistedActiveAssetId}
        canRead={canReadAssets}
        canWrite={canWriteAssets}
        canManagePresets={canManagePresets}
        canUse={canUseAsset}
        pending={assetPending || interactionPending}
        status={assetStatus}
        contentUrl={(asset) => assetContentUrl(guildId, asset)}
        onUpload={(file) => void uploadAsset(file)}
        onUse={useAsset}
        onRename={(asset) => void renameAsset(asset)}
        onTogglePreset={(asset) => void toggleAssetPreset(asset)}
        onDelete={(asset) => void deleteAsset(asset)}
      />

      {background ? (
        <section className="space-y-3 rounded-xl border border-border bg-background p-4">
          <div>
            <h3 className="font-medium">旧カスタム背景（互換）</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              以前の1枚保存方式で登録された画像です。新規画像は上の画像ライブラリへ登録してください。
            </p>
          </div>
          {!canReadBackground ? (
            <p className="text-sm text-muted">旧カスタム背景を閲覧するIAM権限がありません。</p>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{background.fileName}</p>
                <p className="mt-1 text-xs text-muted">
                  {background.width}×{background.height} · {formatBytes(background.sizeBytes)}
                </p>
              </div>
              {canWriteBackground ? (
                <button
                  type="button"
                  onClick={() => void deleteBackground()}
                  disabled={interactionPending}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-300 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> 削除
                </button>
              ) : null}
            </div>
          )}
          <p className="text-xs text-muted" aria-live="polite">
            {backgroundStatus}
          </p>
        </section>
      ) : null}

      {canTestSend ? (
        <section className="space-y-3 rounded-xl border border-primary/20 bg-background p-4">
          <div>
            <h3 className="font-medium">Discordテスト送信</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              現在表示している「変更中 /
              保存済み」のプレビューをPNG化し、指定Channelへ送信します。サンプル表示名・Avatar・8月19日・25歳を使用し、メンションは発生しません。
            </p>
          </div>
          {channelOptions.length > 0 ? (
            <DiscordChannelPicker
              options={channelOptions}
              value={testChannelId}
              onChange={(value) => setTestChannelId(typeof value === 'string' ? value : null)}
              placeholder="テスト送信先Channelを検索"
              guildId={guildId}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
              Botからテスト送信可能なChannelを取得できませんでした。
            </p>
          )}
          <button
            type="button"
            onClick={() => void testSend()}
            disabled={interactionPending || !testChannelId || !backgroundUrl}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {testPending ? 'Discordへ送信中…' : '現在のプレビューをテスト送信'}
          </button>
          <p className="text-sm text-muted" aria-live="polite">
            {testStatus}
          </p>
        </section>
      ) : null}

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" aria-live="polite">
          {status || (dirty ? '未保存の変更があります' : '設定は保存済みです')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={resetChanges}
            disabled={!dirty || interactionPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            未保存変更を戻す
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || interactionPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden="true" />{' '}
            {pending ? '保存中…' : '許可されたCard設定を保存'}
          </button>
        </div>
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
  | 'birthdayCardBackgroundSource'
  | 'birthdayCardAssetId'
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

function resolveBackgroundUrl({
  guildId,
  config,
  canReadBackgroundSource,
  canReadBackground,
  canReadAssets,
  canReadAssetId,
  canReadPreset,
  background,
  asset,
  presetAssetFile,
}: {
  guildId: string;
  config: BirthdayCardConfig;
  canReadBackgroundSource: boolean;
  canReadBackground: boolean;
  canReadAssets: boolean;
  canReadAssetId: boolean;
  canReadPreset: boolean;
  background: BirthdayCardBackgroundMetadata | null;
  asset: BirthdayCardAssetMetadata | null;
  presetAssetFile: string;
}): string | null {
  if (!canReadBackgroundSource) return null;
  if (config.birthdayCardBackgroundSource === 'asset') {
    return canReadAssets && canReadAssetId && asset ? assetContentUrl(guildId, asset) : null;
  }
  if (config.birthdayCardBackgroundSource === 'custom') {
    return canReadBackground && background
      ? `/api/guilds/${guildId}/birthday/card-background?v=${background.sha256}`
      : null;
  }
  return canReadPreset ? `/birthday-card-presets/${presetAssetFile}` : null;
}

function assetContentUrl(guildId: string, asset: BirthdayCardAssetMetadata): string {
  return `/api/guilds/${guildId}/birthday/card-assets/${asset.id}/content?v=${asset.sha256}`;
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.max(1, Math.round(value / 1024))} KiB`;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
