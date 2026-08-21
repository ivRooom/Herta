'use client';

import { BIRTHDAY_CARD_ASSET_MAX_COUNT } from '@herta/shared';
import { Check, Pencil, Star, Trash2, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';

const BACKGROUND_ACCEPT = 'image/png,image/jpeg,image/webp';

export interface BirthdayCardAssetMetadata {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

export function BirthdayCardAssetLibrary({
  assets,
  selectedAssetId,
  protectedAssetId,
  canRead,
  canWrite,
  canManagePresets,
  canUse,
  pending,
  status,
  contentUrl,
  onUpload,
  onUse,
  onRename,
  onTogglePreset,
  onDelete,
}: {
  assets: BirthdayCardAssetMetadata[];
  selectedAssetId: string | null;
  protectedAssetId: string | null;
  canRead: boolean;
  canWrite: boolean;
  canManagePresets: boolean;
  canUse: boolean;
  pending: boolean;
  status: string;
  contentUrl(asset: BirthdayCardAssetMetadata): string;
  onUpload(file: File): void;
  onUse(asset: BirthdayCardAssetMetadata): void;
  onRename(asset: BirthdayCardAssetMetadata): void;
  onTogglePreset(asset: BirthdayCardAssetMetadata): void;
  onDelete(asset: BirthdayCardAssetMetadata): void;
}) {
  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUpload(file);
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-medium">背景画像ライブラリ</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            PNG / JPEG / WebPを最大{BIRTHDAY_CARD_ASSET_MAX_COUNT}
            件登録できます。登録後に必要な画像だけGuildプリセットへ追加できます。
          </p>
        </div>
        {canRead && canWrite ? (
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {pending ? '処理中…' : '画像を登録'}
            <input
              type="file"
              accept={BACKGROUND_ACCEPT}
              disabled={pending || assets.length >= BIRTHDAY_CARD_ASSET_MAX_COUNT}
              onChange={handleUpload}
              className="sr-only"
            />
          </label>
        ) : null}
      </div>

      {!canRead ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          画像ライブラリを閲覧するIAM権限がありません。
        </p>
      ) : assets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          画像はまだ登録されていません。画像を登録してから、必要に応じてPresetへ追加してください。
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {assets.map((asset) => {
            const selected = asset.id === selectedAssetId;
            const protectedFromDelete = asset.id === protectedAssetId;
            return (
              <article
                key={asset.id}
                className={`overflow-hidden rounded-xl border bg-surface ${
                  selected ? 'border-primary/70 ring-1 ring-primary/30' : 'border-border'
                }`}
              >
                <div
                  role="img"
                  aria-label={`${asset.name} の背景画像プレビュー`}
                  className="aspect-[16/9] bg-cover bg-center bg-no-repeat"
                  style={{
                    backgroundImage: `url(${JSON.stringify(contentUrl(asset)).slice(1, -1)})`,
                  }}
                />
                <div className="space-y-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{asset.name}</p>
                      {selected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Check className="h-3 w-3" aria-hidden="true" /> 使用中
                        </span>
                      ) : null}
                      {asset.isPreset ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          <Star className="h-3 w-3" aria-hidden="true" /> Guild Preset
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {asset.width}×{asset.height} · {formatBytes(asset.sizeBytes)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {canUse ? (
                      <button
                        type="button"
                        disabled={pending || selected}
                        onClick={() => onUse(asset)}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {selected ? '使用中' : 'この背景を使用'}
                      </button>
                    ) : null}
                    {canManagePresets ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onTogglePreset(asset)}
                        className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        {asset.isPreset ? 'Presetから解除' : 'Presetに追加'}
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onRename(asset)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> 名前変更
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button
                        type="button"
                        disabled={
                          pending ||
                          selected ||
                          protectedFromDelete ||
                          (asset.isPreset && !canManagePresets)
                        }
                        onClick={() => onDelete(asset)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> 削除
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.max(1, Math.round(value / 1024))} KiB`;
}
