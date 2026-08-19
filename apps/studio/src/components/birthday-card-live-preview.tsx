'use client';

import { birthdayCardPreset, type BirthdayCardConfig } from '@herta/shared';
import { Move } from 'lucide-react';
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextStrokeWidth,
  nudgeBirthdayCardPosition,
  pointerToBirthdayCardPosition,
} from '@/lib/birthday-card-preview';

export type BirthdayCardPositionXKey =
  | 'birthdayCardAvatarX'
  | 'birthdayCardNameX'
  | 'birthdayCardBirthdayX'
  | 'birthdayCardAgeX';

export type BirthdayCardPositionYKey =
  | 'birthdayCardAvatarY'
  | 'birthdayCardNameY'
  | 'birthdayCardBirthdayY'
  | 'birthdayCardAgeY';

interface BirthdayCardLivePreviewProps {
  config: BirthdayCardConfig;
  readable: ReadonlySet<string>;
  editable: ReadonlySet<string>;
  pending: boolean;
  onPositionChange(
    xKey: BirthdayCardPositionXKey,
    yKey: BirthdayCardPositionYKey,
    x: number,
    y: number,
  ): void;
}

export function BirthdayCardLivePreview({
  config,
  readable,
  editable,
  pending,
  onPositionChange,
}: BirthdayCardLivePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const preset = birthdayCardPreset(config.birthdayCardPreset);
  const canPreviewPreset = readable.has('birthdayCardPreset');
  const hiddenLayoutLabels: string[] = [];

  const avatarVisible =
    readable.has('birthdayCardShowAvatar') &&
    config.birthdayCardShowAvatar &&
    hasReadableLayout(readable, 'birthdayCardAvatarX', 'birthdayCardAvatarY', 'birthdayCardAvatarSize');
  if (
    readable.has('birthdayCardShowAvatar') &&
    config.birthdayCardShowAvatar &&
    !avatarVisible
  ) {
    hiddenLayoutLabels.push('Avatar');
  }

  const nameVisible =
    canPreviewPreset &&
    readable.has('birthdayCardShowName') &&
    config.birthdayCardShowName &&
    hasReadableLayout(readable, 'birthdayCardNameX', 'birthdayCardNameY', 'birthdayCardNameSize');
  if (readable.has('birthdayCardShowName') && config.birthdayCardShowName && !nameVisible) {
    hiddenLayoutLabels.push('名前');
  }

  const birthdayVisible =
    canPreviewPreset &&
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
    canPreviewPreset &&
    readable.has('birthdayCardShowAge') &&
    config.birthdayCardShowAge &&
    hasReadableLayout(readable, 'birthdayCardAgeX', 'birthdayCardAgeY', 'birthdayCardAgeSize');
  if (readable.has('birthdayCardShowAge') && config.birthdayCardShowAge && !ageVisible) {
    hiddenLayoutLabels.push('年齢');
  }

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
  ) {
    const movable = !pending && (editable.has(xKey) || editable.has(yKey));
    return {
      movable,
      onPointerDown(event: ReactPointerEvent<SVGGElement>) {
        if (!movable) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        moveFromPointer(event, xKey, yKey, currentX, currentY);
      },
      onPointerMove(event: ReactPointerEvent<SVGGElement>) {
        if (!movable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        moveFromPointer(event, xKey, yKey, currentX, currentY);
      },
      onPointerUp(event: ReactPointerEvent<SVGGElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onPointerCancel(event: ReactPointerEvent<SVGGElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onKeyDown(event: ReactKeyboardEvent<SVGGElement>) {
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
            ドラッグ / 矢印キーで移動
          </span>
        </div>
      </div>

      <div className="relative aspect-[1672/941] overflow-hidden rounded-2xl border border-border bg-background shadow-inner">
        {canPreviewPreset ? (
          <img
            src={`/birthday-card-presets/${preset.assetFile}`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-sm text-muted">
            背景プリセットはIAM権限により非表示です
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${BIRTHDAY_CARD_PREVIEW_WIDTH} ${BIRTHDAY_CARD_PREVIEW_HEIGHT}`}
          className="absolute inset-0 h-full w-full select-none"
          aria-label="Birthday Cardライブプレビュー"
          role="img"
        >
          {avatarVisible ? (
            <PreviewAvatar
              x={config.birthdayCardAvatarX}
              y={config.birthdayCardAvatarY}
              geometry={avatarGeometry}
              handlers={pointerHandlers(
                'birthdayCardAvatarX',
                'birthdayCardAvatarY',
                config.birthdayCardAvatarX,
                config.birthdayCardAvatarY,
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
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardNameX',
                'birthdayCardNameY',
                config.birthdayCardNameX,
                config.birthdayCardNameY,
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
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardBirthdayX',
                'birthdayCardBirthdayY',
                config.birthdayCardBirthdayX,
                config.birthdayCardBirthdayY,
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
              color={preset.textColor}
              stroke={preset.textStroke}
              handlers={pointerHandlers(
                'birthdayCardAgeX',
                'birthdayCardAgeY',
                config.birthdayCardAgeX,
                config.birthdayCardAgeY,
              )}
            />
          ) : null}
        </svg>
      </div>

      {hiddenLayoutLabels.length > 0 ? (
        <p className="text-xs text-muted" role="status">
          {hiddenLayoutLabels.join('・')} のプレビューは、表示に必要なIAM設定項目が一部非表示のため描画していません。
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted">
        プレビュー上の要素を直接ドラッグできます。キーボードでは矢印キーで1%、Shift +
        矢印キーで5%ずつ移動します。右側のスライダー操作も即時反映されます。
      </p>
    </div>
  );
}

type PreviewInteractionHandlers = ReturnType<
  typeof createPreviewInteractionHandlerShape
>;

function createPreviewInteractionHandlerShape() {
  return {
    movable: false,
    onPointerDown: (_event: ReactPointerEvent<SVGGElement>) => undefined,
    onPointerMove: (_event: ReactPointerEvent<SVGGElement>) => undefined,
    onPointerUp: (_event: ReactPointerEvent<SVGGElement>) => undefined,
    onPointerCancel: (_event: ReactPointerEvent<SVGGElement>) => undefined,
    onKeyDown: (_event: ReactKeyboardEvent<SVGGElement>) => undefined,
  };
}

function PreviewAvatar({
  x,
  y,
  geometry,
  handlers,
}: {
  x: number;
  y: number;
  geometry: ReturnType<typeof birthdayCardAvatarGeometry>;
  handlers: PreviewInteractionHandlers;
}) {
  const { movable, ...interactionHandlers } = handlers;
  return (
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
        className={movable ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100' : 'opacity-0'}
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
  );
}

function PreviewText({
  label,
  value,
  x,
  y,
  size,
  color,
  stroke,
  handlers,
}: {
  label: string;
  value: string;
  x: number;
  y: number;
  size: number;
  color: string;
  stroke: string;
  handlers: PreviewInteractionHandlers;
}) {
  const { movable, ...interactionHandlers } = handlers;
  const xPx = (BIRTHDAY_CARD_PREVIEW_WIDTH * x) / 100;
  const yPx = (BIRTHDAY_CARD_PREVIEW_HEIGHT * y) / 100;
  const hitWidth = Math.min(
    BIRTHDAY_CARD_PREVIEW_WIDTH * 0.88,
    Math.max(size * 4, size * Math.max(4, value.length) * 0.78),
  );
  const hitHeight = Math.max(size * 1.6, 48);

  return (
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
        className={movable ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100' : 'opacity-0'}
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
  );
}

function hasReadableLayout(
  readable: ReadonlySet<string>,
  xKey: BirthdayCardPositionXKey,
  yKey: BirthdayCardPositionYKey,
  sizeKey:
    | 'birthdayCardAvatarSize'
    | 'birthdayCardNameSize'
    | 'birthdayCardBirthdaySize'
    | 'birthdayCardAgeSize',
): boolean {
  return readable.has(xKey) && readable.has(yKey) && readable.has(sizeKey);
}
