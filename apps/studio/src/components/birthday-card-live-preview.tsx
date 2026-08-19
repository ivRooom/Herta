'use client';

import { birthdayCardPreset, type BirthdayCardConfig } from '@herta/shared';
import { ImageOff, Move } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextHitWidth,
  birthdayCardTextStrokeWidth,
  nudgeBirthdayCardPosition,
  nudgeBirthdayCardSize,
  pointerDeltaToBirthdayCardPixels,
  pointerToBirthdayCardPosition,
  resizeBirthdayCardAvatarSize,
  resizeBirthdayCardTextSize,
} from '@/lib/birthday-card-preview';

export type BirthdayCardPositionXKey =
  'birthdayCardAvatarX' | 'birthdayCardNameX' | 'birthdayCardBirthdayX' | 'birthdayCardAgeX';

export type BirthdayCardPositionYKey =
  'birthdayCardAvatarY' | 'birthdayCardNameY' | 'birthdayCardBirthdayY' | 'birthdayCardAgeY';

export type BirthdayCardSizeKey =
  | 'birthdayCardAvatarSize'
  | 'birthdayCardNameSize'
  | 'birthdayCardBirthdaySize'
  | 'birthdayCardAgeSize';

interface BirthdayCardLivePreviewProps {
  config: BirthdayCardConfig;
  readable: ReadonlySet<string>;
  editable: ReadonlySet<string>;
  pending: boolean;
  backgroundUrl: string | null;
  backgroundLabel: string;
  onPositionChange(
    xKey: BirthdayCardPositionXKey,
    yKey: BirthdayCardPositionYKey,
    x: number,
    y: number,
  ): void;
  onSizeChange(sizeKey: BirthdayCardSizeKey, size: number): void;
}

interface PreviewInteractionHandlers {
  movable: boolean;
  onPointerDown(event: ReactPointerEvent<SVGGElement>): void;
  onPointerMove(event: ReactPointerEvent<SVGGElement>): void;
  onPointerUp(event: ReactPointerEvent<SVGGElement>): void;
  onPointerCancel(event: ReactPointerEvent<SVGGElement>): void;
  onKeyDown(event: ReactKeyboardEvent<SVGGElement>): void;
}

interface PreviewResizeHandlers {
  resizable: boolean;
  onPointerDown(event: ReactPointerEvent<SVGGElement>): void;
  onPointerMove(event: ReactPointerEvent<SVGGElement>): void;
  onPointerUp(event: ReactPointerEvent<SVGGElement>): void;
  onPointerCancel(event: ReactPointerEvent<SVGGElement>): void;
  onKeyDown(event: ReactKeyboardEvent<SVGGElement>): void;
}

interface ActiveResize {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startSize: number;
}

type ResizeKind = 'avatar' | 'text';

export function BirthdayCardLivePreview({
  config,
  readable,
  editable,
  pending,
  backgroundUrl,
  backgroundLabel,
  onPositionChange,
  onSizeChange,
}: BirthdayCardLivePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const activeResizeRef = useRef<ActiveResize | null>(null);
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const preset = birthdayCardPreset(config.birthdayCardPreset);
  const canPreviewTextPalette = readable.has('birthdayCardPreset');
  const hiddenLayoutLabels: string[] = [];

  useEffect(() => {
    setBackgroundFailed(false);
  }, [backgroundUrl]);

  const avatarVisible =
    readable.has('birthdayCardShowAvatar') &&
    config.birthdayCardShowAvatar &&
    hasReadableLayout(
      readable,
      'birthdayCardAvatarX',
      'birthdayCardAvatarY',
      'birthdayCardAvatarSize',
    );
  if (readable.has('birthdayCardShowAvatar') && config.birthdayCardShowAvatar && !avatarVisible) {
    hiddenLayoutLabels.push('Avatar');
  }

  const nameVisible =
    canPreviewTextPalette &&
    readable.has('birthdayCardShowName') &&
    config.birthdayCardShowName &&
    hasReadableLayout(readable, 'birthdayCardNameX', 'birthdayCardNameY', 'birthdayCardNameSize');
  if (readable.has('birthdayCardShowName') && config.birthdayCardShowName && !nameVisible) {
    hiddenLayoutLabels.push('名前');
  }

  const birthdayVisible =
    canPreviewTextPalette &&
    readable.has('birthdayCardShowBirthday') &&
    config.birthdayCardShowBirthday &&
    hasReadableLayout(
      readable,
      'birthdayCardBirthdayX',
      'birthdayCardBirthdayY',
      'birthdayCardBirthdaySize',
    );
  if (
    readable.has('birthdayCardShowBirthday') &&
    config.birthdayCardShowBirthday &&
    !birthdayVisible
  ) {
    hiddenLayoutLabels.push('誕生日');
  }

  const ageVisible =
    canPreviewTextPalette &&
    readable.has('birthdayCardShowAge') &&
    config.birthdayCardShowAge &&
    hasReadableLayout(readable, 'birthdayCardAgeX', 'birthdayCardAgeY', 'birthdayCardAgeSize');
  if (readable.has('birthdayCardShowAge') && config.birthdayCardShowAge && !ageVisible) {
    hiddenLayoutLabels.push('年齢');
  }

  const canMovePreview =
    !pending &&
    ((avatarVisible &&
      (editable.has('birthdayCardAvatarX') || editable.has('birthdayCardAvatarY'))) ||
      (nameVisible && (editable.has('birthdayCardNameX') || editable.has('birthdayCardNameY'))) ||
      (birthdayVisible &&
        (editable.has('birthdayCardBirthdayX') || editable.has('birthdayCardBirthdayY'))) ||
      (ageVisible && (editable.has('birthdayCardAgeX') || editable.has('birthdayCardAgeY'))));
  const canResizePreview =
    !pending &&
    ((avatarVisible && editable.has('birthdayCardAvatarSize')) ||
      (nameVisible && editable.has('birthdayCardNameSize')) ||
      (birthdayVisible && editable.has('birthdayCardBirthdaySize')) ||
      (ageVisible && editable.has('birthdayCardAgeSize')));
  const canEditPreview = canMovePreview || canResizePreview;

  function moveFromPointer(
    event: ReactPointerEvent<SVGGElement>,
    xKey: BirthdayCardPositionXKey,
    yKey: BirthdayCardPositionYKey,
    currentX: number,
    currentY: number,
  ) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = pointerToBirthdayCardPosition(event.clientX, event.clientY, rect);
    if (!next) return;

    onPositionChange(
      xKey,
      yKey,
      editable.has(xKey) ? next.x : currentX,
      editable.has(yKey) ? next.y : currentY,
    );
  }

  function pointerHandlers(
    xKey: BirthdayCardPositionXKey,
    yKey: BirthdayCardPositionYKey,
    currentX: number,
    currentY: number,
  ): PreviewInteractionHandlers {
    const movable = !pending && (editable.has(xKey) || editable.has(yKey));
    return {
      movable,
      onPointerDown(event) {
        if (!movable) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        moveFromPointer(event, xKey, yKey, currentX, currentY);
      },
      onPointerMove(event) {
        if (!movable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        moveFromPointer(event, xKey, yKey, currentX, currentY);
      },
      onPointerUp(event) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onPointerCancel(event) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onKeyDown(event) {
        if (!movable) return;
        const step = event.shiftKey ? 5 : 1;
        const horizontal = editable.has(xKey);
        const vertical = editable.has(yKey);
        let deltaX = 0;
        let deltaY = 0;

        if (event.key === 'ArrowLeft' && horizontal) deltaX = -step;
        else if (event.key === 'ArrowRight' && horizontal) deltaX = step;
        else if (event.key === 'ArrowUp' && vertical) deltaY = -step;
        else if (event.key === 'ArrowDown' && vertical) deltaY = step;
        else return;

        event.preventDefault();
        const next = nudgeBirthdayCardPosition({ x: currentX, y: currentY }, deltaX, deltaY);
        onPositionChange(xKey, yKey, next.x, next.y);
      },
    };
  }

  function resizeHandlers(
    sizeKey: BirthdayCardSizeKey,
    currentSize: number,
    minSize: number,
    maxSize: number,
    kind: ResizeKind,
    valueLength = 0,
  ): PreviewResizeHandlers {
    const resizable = !pending && editable.has(sizeKey);

    function finishResize(event: ReactPointerEvent<SVGGElement>) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (activeResizeRef.current?.pointerId === event.pointerId) {
        activeResizeRef.current = null;
      }
    }

    return {
      resizable,
      onPointerDown(event) {
        if (!resizable) return;
        event.preventDefault();
        event.stopPropagation();
        activeResizeRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startSize: currentSize,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const active = activeResizeRef.current;
        if (
          !resizable ||
          !active ||
          active.pointerId !== event.pointerId ||
          !event.currentTarget.hasPointerCapture(event.pointerId)
        ) {
          return;
        }
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const delta = pointerDeltaToBirthdayCardPixels(
          active.startClientX,
          active.startClientY,
          event.clientX,
          event.clientY,
          rect,
        );
        if (!delta) return;

        const nextSize =
          kind === 'avatar'
            ? resizeBirthdayCardAvatarSize(active.startSize, delta.x, minSize, maxSize)
            : resizeBirthdayCardTextSize(active.startSize, delta.x, valueLength, minSize, maxSize);
        onSizeChange(sizeKey, nextSize);
      },
      onPointerUp(event) {
        finishResize(event);
      },
      onPointerCancel(event) {
        finishResize(event);
      },
      onKeyDown(event) {
        if (!resizable) return;
        const step = event.shiftKey ? 5 : 1;
        let delta = 0;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = step;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -step;
        else return;

        event.preventDefault();
        event.stopPropagation();
        onSizeChange(sizeKey, nudgeBirthdayCardSize(currentSize, delta, minSize, maxSize));
      },
    };
  }

  const avatarGeometry = birthdayCardAvatarGeometry(
    config.birthdayCardAvatarX,
    config.birthdayCardAvatarY,
    config.birthdayCardAvatarSize,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">ライブプレビュー</h3>
          <p className="mt-0.5 text-xs text-muted">
            1672×941のBot描画と同じ座標系。表示名・Avatar・日付・年齢はサンプルです。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!config.birthdayCardEnabled && readable.has('birthdayCardEnabled') ? (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              投稿OFF
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted">
            <Move className="h-3.5 w-3.5" aria-hidden="true" />
            {canEditPreview ? 'プレビュー上で直接編集' : '閲覧プレビュー'}
          </span>
        </div>
      </div>

      <div className="relative aspect-[1672/941] overflow-hidden rounded-2xl border border-border bg-background shadow-inner">
        {backgroundUrl && !backgroundFailed ? (
          <img
            src={backgroundUrl}
            alt=""
            aria-hidden="true"
            onError={() => setBackgroundFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-muted"
            role="status"
          >
            <ImageOff className="h-8 w-8" aria-hidden="true" />
            <span>
              {backgroundFailed
                ? `${backgroundLabel} を読み込めませんでした`
                : '背景画像は未設定またはIAM権限により非表示です'}
            </span>
            {backgroundFailed ? (
              <span className="text-xs">
                保存済みアセットとStudioのデプロイ状態を確認してください。
              </span>
            ) : null}
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${BIRTHDAY_CARD_PREVIEW_WIDTH} ${BIRTHDAY_CARD_PREVIEW_HEIGHT}`}
          className="absolute inset-0 h-full w-full select-none"
          aria-label="Birthday Cardライブプレビュー"
          role="group"
        >
          {avatarVisible ? (
            <PreviewAvatar
              x={config.birthdayCardAvatarX}
              y={config.birthdayCardAvatarY}
              size={config.birthdayCardAvatarSize}
              geometry={avatarGeometry}
              handlers={pointerHandlers(
                'birthdayCardAvatarX',
                'birthdayCardAvatarY',
                config.birthdayCardAvatarX,
                config.birthdayCardAvatarY,
              )}
              resizeHandlers={resizeHandlers(
                'birthdayCardAvatarSize',
                config.birthdayCardAvatarSize,
                6,
                30,
                'avatar',
              )}
            />
          ) : null}
          {nameVisible ? (
            <PreviewText
              label="名前"
              value="Herta Member"
              x={config.birthdayCardNameX}
              y={config.birthdayCardNameY}
              size={config.birthdayCardNameSize}
              minSize={20}
              maxSize={96}
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardNameX',
                'birthdayCardNameY',
                config.birthdayCardNameX,
                config.birthdayCardNameY,
              )}
              resizeHandlers={resizeHandlers(
                'birthdayCardNameSize',
                config.birthdayCardNameSize,
                20,
                96,
                'text',
                'Herta Member'.length,
              )}
            />
          ) : null}
          {birthdayVisible ? (
            <PreviewText
              label="誕生日"
              value="8月19日"
              x={config.birthdayCardBirthdayX}
              y={config.birthdayCardBirthdayY}
              size={config.birthdayCardBirthdaySize}
              minSize={16}
              maxSize={72}
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardBirthdayX',
                'birthdayCardBirthdayY',
                config.birthdayCardBirthdayX,
                config.birthdayCardBirthdayY,
              )}
              resizeHandlers={resizeHandlers(
                'birthdayCardBirthdaySize',
                config.birthdayCardBirthdaySize,
                16,
                72,
                'text',
                '8月19日'.length,
              )}
            />
          ) : null}
          {ageVisible ? (
            <PreviewText
              label="年齢"
              value="25歳"
              x={config.birthdayCardAgeX}
              y={config.birthdayCardAgeY}
              size={config.birthdayCardAgeSize}
              minSize={16}
              maxSize={72}
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardAgeX',
                'birthdayCardAgeY',
                config.birthdayCardAgeX,
                config.birthdayCardAgeY,
              )}
              resizeHandlers={resizeHandlers(
                'birthdayCardAgeSize',
                config.birthdayCardAgeSize,
                16,
                72,
                'text',
                '25歳'.length,
              )}
            />
          ) : null}
        </svg>
      </div>

      {hiddenLayoutLabels.length > 0 ? (
        <p className="text-xs text-muted" role="status">
          {hiddenLayoutLabels.join('・')}{' '}
          のプレビューは、表示に必要なIAM設定項目が一部非表示のため描画していません。
        </p>
      ) : null}
      {canEditPreview ? (
        <p className="text-xs leading-5 text-muted">
          {canMovePreview
            ? '要素をドラッグ、または矢印キーで位置を調整できます。'
            : '位置は現在のIAM権限では変更できません。'}{' '}
          {canResizePreview
            ? '要素右側の丸いハンドルを左右へドラッグするとサイズを変更できます。ハンドル選択中は矢印キー、Shift + 矢印キーで1 / 5ずつ微調整できます。'
            : 'サイズは現在のIAM権限では変更できません。'}{' '}
          右側のスライダー操作も即時反映されます。
        </p>
      ) : (
        <p className="text-xs leading-5 text-muted">
          この表示は閲覧専用です。位置・サイズ調整は編集可能なプレビューまたはレイアウト設定から行ってください。
        </p>
      )}
    </div>
  );
}

function PreviewAvatar({
  x,
  y,
  size,
  geometry,
  handlers,
  resizeHandlers,
}: {
  x: number;
  y: number;
  size: number;
  geometry: ReturnType<typeof birthdayCardAvatarGeometry>;
  handlers: PreviewInteractionHandlers;
  resizeHandlers: PreviewResizeHandlers;
}) {
  const { movable, ...interactionHandlers } = handlers;
  return (
    <>
      <g
        {...interactionHandlers}
        role={movable ? 'button' : undefined}
        tabIndex={movable ? 0 : undefined}
        aria-label={movable ? `Avatar位置 X ${Math.round(x)} Y ${Math.round(y)}` : undefined}
        className={movable ? 'group cursor-move outline-none' : undefined}
        style={{ touchAction: movable ? 'none' : undefined }}
      >
        <circle
          cx={geometry.centerX}
          cy={geometry.centerY}
          r={geometry.diameter / 2 + 10}
          fill="transparent"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="4"
          strokeDasharray="12 10"
          className={
            movable
              ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100'
              : 'opacity-0'
          }
        />
        <circle
          cx={geometry.centerX}
          cy={geometry.centerY}
          r={geometry.diameter / 2}
          fill="#6d5bd0"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="5"
        />
        <text
          x={geometry.centerX}
          y={geometry.centerY}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontFamily="Noto Sans CJK JP, Noto Sans CJK, sans-serif"
          fontSize={Math.max(28, Math.round(geometry.diameter * 0.22))}
          fontWeight="700"
          pointerEvents="none"
        >
          HM
        </text>
      </g>
      <ResizeHandle
        label="Avatar"
        x={resizeHandleX(geometry.centerX + geometry.diameter / 2)}
        y={resizeHandleY(geometry.centerY)}
        size={size}
        minSize={6}
        maxSize={30}
        handlers={resizeHandlers}
      />
    </>
  );
}

function PreviewText({
  label,
  value,
  x,
  y,
  size,
  minSize,
  maxSize,
  color,
  stroke,
  handlers,
  resizeHandlers,
}: {
  label: string;
  value: string;
  x: number;
  y: number;
  size: number;
  minSize: number;
  maxSize: number;
  color: string;
  stroke: string;
  handlers: PreviewInteractionHandlers;
  resizeHandlers: PreviewResizeHandlers;
}) {
  const { movable, ...interactionHandlers } = handlers;
  const xPx = (BIRTHDAY_CARD_PREVIEW_WIDTH * x) / 100;
  const yPx = (BIRTHDAY_CARD_PREVIEW_HEIGHT * y) / 100;
  const hitWidth = birthdayCardTextHitWidth(value.length, size);
  const hitHeight = Math.max(size * 1.6, 48);

  return (
    <>
      <g
        {...interactionHandlers}
        role={movable ? 'button' : undefined}
        tabIndex={movable ? 0 : undefined}
        aria-label={movable ? `${label}位置 X ${Math.round(x)} Y ${Math.round(y)}` : undefined}
        className={movable ? 'group cursor-move outline-none' : undefined}
        style={{ touchAction: movable ? 'none' : undefined }}
      >
        <rect
          x={xPx - hitWidth / 2}
          y={yPx - hitHeight / 2}
          width={hitWidth}
          height={hitHeight}
          rx={12}
          fill="rgba(109,91,208,0.10)"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="4"
          strokeDasharray="12 10"
          className={
            movable
              ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100'
              : 'opacity-0'
          }
        />
        <text
          x={xPx}
          y={yPx}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Noto Sans CJK JP, Noto Sans CJK, sans-serif"
          fontSize={Math.round(size)}
          fontWeight="700"
          fill={color}
          stroke={stroke}
          strokeWidth={birthdayCardTextStrokeWidth(size)}
          paintOrder="stroke fill"
          strokeLinejoin="round"
          pointerEvents="none"
        >
          {value}
        </text>
      </g>
      <ResizeHandle
        label={label}
        x={resizeHandleX(xPx + hitWidth / 2)}
        y={resizeHandleY(yPx)}
        size={size}
        minSize={minSize}
        maxSize={maxSize}
        handlers={resizeHandlers}
      />
    </>
  );
}

function ResizeHandle({
  label,
  x,
  y,
  size,
  minSize,
  maxSize,
  handlers,
}: {
  label: string;
  x: number;
  y: number;
  size: number;
  minSize: number;
  maxSize: number;
  handlers: PreviewResizeHandlers;
}) {
  const { resizable, ...interactionHandlers } = handlers;
  if (!resizable) return null;

  return (
    <g
      {...interactionHandlers}
      role="slider"
      tabIndex={0}
      aria-label={`${label}サイズ`}
      aria-orientation="horizontal"
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      aria-valuenow={Math.round(size)}
      className="group cursor-ew-resize outline-none"
      style={{ touchAction: 'none' }}
    >
      <title>{`${label}サイズを変更`}</title>
      <circle cx={x} cy={y} r={32} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={16}
        fill="rgba(109,91,208,0.96)"
        stroke="rgba(255,255,255,0.98)"
        strokeWidth={5}
        className="transition-[r] group-hover:[r:20px] group-focus:[r:20px]"
      />
      <line
        x1={x - 7}
        y1={y}
        x2={x + 7}
        y2={y}
        stroke="white"
        strokeWidth={4}
        strokeLinecap="round"
        pointerEvents="none"
      />
    </g>
  );
}

function resizeHandleX(value: number): number {
  return Math.min(BIRTHDAY_CARD_PREVIEW_WIDTH - 32, Math.max(32, value));
}

function resizeHandleY(value: number): number {
  return Math.min(BIRTHDAY_CARD_PREVIEW_HEIGHT - 32, Math.max(32, value));
}

function hasReadableLayout(
  readable: ReadonlySet<string>,
  xKey: BirthdayCardPositionXKey,
  yKey: BirthdayCardPositionYKey,
  sizeKey: BirthdayCardSizeKey,
): boolean {
  return readable.has(xKey) && readable.has(yKey) && readable.has(sizeKey);
}
