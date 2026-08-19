export const BIRTHDAY_CARD_PREVIEW_WIDTH = 1672;
export const BIRTHDAY_CARD_PREVIEW_HEIGHT = 941;

export interface BirthdayCardPreviewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BirthdayCardPreviewPosition {
  x: number;
  y: number;
}

export interface BirthdayCardAvatarGeometry {
  centerX: number;
  centerY: number;
  diameter: number;
}

export function pointerToBirthdayCardPosition(
  clientX: number,
  clientY: number,
  rect: BirthdayCardPreviewRect,
): BirthdayCardPreviewPosition | null {
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    x: clampPercent(Math.round(((clientX - rect.left) / rect.width) * 100)),
    y: clampPercent(Math.round(((clientY - rect.top) / rect.height) * 100)),
  };
}

export function nudgeBirthdayCardPosition(
  position: BirthdayCardPreviewPosition,
  deltaX: number,
  deltaY: number,
): BirthdayCardPreviewPosition {
  return {
    x: clampPercent(position.x + deltaX),
    y: clampPercent(position.y + deltaY),
  };
}

export function birthdayCardAvatarGeometry(
  xPercent: number,
  yPercent: number,
  sizePercent: number,
): BirthdayCardAvatarGeometry {
  const diameter = Math.max(
    64,
    Math.round((BIRTHDAY_CARD_PREVIEW_WIDTH * sizePercent) / 100),
  );
  const left = clamp(
    Math.round((BIRTHDAY_CARD_PREVIEW_WIDTH * xPercent) / 100 - diameter / 2),
    0,
    BIRTHDAY_CARD_PREVIEW_WIDTH - diameter,
  );
  const top = clamp(
    Math.round((BIRTHDAY_CARD_PREVIEW_HEIGHT * yPercent) / 100 - diameter / 2),
    0,
    BIRTHDAY_CARD_PREVIEW_HEIGHT - diameter,
  );

  return {
    centerX: left + diameter / 2,
    centerY: top + diameter / 2,
    diameter,
  };
}

export function birthdayCardTextStrokeWidth(fontSize: number): number {
  return Math.max(2, Math.round(fontSize / 18));
}

function clampPercent(value: number): number {
  return clamp(value, 0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
