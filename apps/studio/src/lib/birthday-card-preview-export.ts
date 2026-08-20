import { birthdayCardPreset, type BirthdayCardConfig } from '@herta/shared';
import { getBirthdayCardPreviewSelectionForPathname } from './birthday-card-preview-selection.ts';
import {
  birthdayCardPreviewSubject,
  type BirthdayCardPreviewMember,
} from './birthday-card-preview-subject.ts';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextStrokeWidth,
} from './birthday-card-preview.ts';

const PREVIEW_IMAGE_TIMEOUT_MS = 10_000;
const MEMBER_PREVIEW_TIMEOUT_MS = 12_000;

export interface BirthdayCardPreviewCoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function birthdayCardPreviewCoverRect(
  imageWidth: number,
  imageHeight: number,
): BirthdayCardPreviewCoverRect | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const scale = Math.max(
    BIRTHDAY_CARD_PREVIEW_WIDTH / imageWidth,
    BIRTHDAY_CARD_PREVIEW_HEIGHT / imageHeight,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (BIRTHDAY_CARD_PREVIEW_WIDTH - width) / 2,
    y: (BIRTHDAY_CARD_PREVIEW_HEIGHT - height) / 2,
    width,
    height,
  };
}

export async function renderBirthdayCardPreviewPng(
  config: BirthdayCardConfig,
  backgroundUrl: string,
  member?: BirthdayCardPreviewMember | null,
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Birthday Cardプレビューはブラウザでのみ生成できます');
  }

  const resolvedMember = member === undefined ? await resolveSelectedPreviewMember() : member;
  const background = await loadImage(backgroundUrl, false, '背景画像');
  const cover = birthdayCardPreviewCoverRect(background.naturalWidth, background.naturalHeight);
  if (!cover) throw new Error('背景画像のサイズを取得できませんでした');

  const canvas = document.createElement('canvas');
  canvas.width = BIRTHDAY_CARD_PREVIEW_WIDTH;
  canvas.height = BIRTHDAY_CARD_PREVIEW_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Birthday Card描画機能を利用できません');

  context.drawImage(background, cover.x, cover.y, cover.width, cover.height);
  const preset = birthdayCardPreset(config.birthdayCardPreset);
  const subject = birthdayCardPreviewSubject(resolvedMember);

  if (config.birthdayCardShowAvatar) {
    const avatar = birthdayCardAvatarGeometry(
      config.birthdayCardAvatarX,
      config.birthdayCardAvatarY,
      config.birthdayCardAvatarSize,
    );
    const avatarImage = subject.avatarUrl
      ? await loadImage(subject.avatarUrl, true, 'Avatar').catch(() => null)
      : null;

    context.save();
    context.beginPath();
    context.arc(avatar.centerX, avatar.centerY, avatar.diameter / 2, 0, Math.PI * 2);
    context.clip();
    if (avatarImage) {
      drawImageCover(context, avatarImage, avatar);
    } else {
      context.fillStyle = '#6d5bd0';
      context.fillRect(
        avatar.centerX - avatar.diameter / 2,
        avatar.centerY - avatar.diameter / 2,
        avatar.diameter,
        avatar.diameter,
      );
      context.fillStyle = '#ffffff';
      context.font = `700 ${Math.max(28, Math.round(avatar.diameter * 0.24))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(subject.initials, avatar.centerX, avatar.centerY);
    }
    context.restore();

    context.save();
    context.beginPath();
    context.arc(avatar.centerX, avatar.centerY, avatar.diameter / 2, 0, Math.PI * 2);
    context.lineWidth = Math.max(3, Math.round(avatar.diameter / 80));
    context.strokeStyle = '#ffffff';
    context.stroke();
    context.restore();
  }

  if (config.birthdayCardShowName) {
    drawText(
      context,
      subject.displayName,
      config.birthdayCardNameX,
      config.birthdayCardNameY,
      config.birthdayCardNameSize,
      preset.textColor,
      preset.textStroke,
    );
  }
  if (config.birthdayCardShowBirthday) {
    drawText(
      context,
      subject.birthdayText,
      config.birthdayCardBirthdayX,
      config.birthdayCardBirthdayY,
      config.birthdayCardBirthdaySize,
      preset.textColor,
      preset.textStroke,
    );
  }
  if (config.birthdayCardShowAge) {
    drawText(
      context,
      subject.ageText,
      config.birthdayCardAgeX,
      config.birthdayCardAgeY,
      config.birthdayCardAgeSize,
      preset.textColor,
      preset.textStroke,
    );
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Birthday Card PNGの生成に失敗しました'))),
      'image/png',
    );
  });
}

async function resolveSelectedPreviewMember(): Promise<BirthdayCardPreviewMember | null> {
  const selection = getBirthdayCardPreviewSelectionForPathname(window.location.pathname);
  if (!selection) return null;

  const endpoint = new URL(
    `/api/guilds/${selection.guildId}/birthday/member-preview`,
    window.location.origin,
  );
  endpoint.searchParams.set('userId', selection.userId);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MEMBER_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
      member?: BirthdayCardPreviewMember;
    } | null;
    if (!response.ok || !payload?.member) {
      throw new Error(
        typeof payload?.error === 'string'
          ? payload.error
          : 'テスト送信用の実メンバー情報を取得できませんでした',
      );
    }
    return payload.member;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('テスト送信用の実メンバー情報取得がタイムアウトしました');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  avatar: ReturnType<typeof birthdayCardAvatarGeometry>,
) {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = 1;
  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sw = image.naturalHeight;
    sx = (image.naturalWidth - sw) / 2;
  } else if (sourceRatio < targetRatio) {
    sh = image.naturalWidth;
    sy = (image.naturalHeight - sh) / 2;
  }

  context.drawImage(
    image,
    sx,
    sy,
    sw,
    sh,
    avatar.centerX - avatar.diameter / 2,
    avatar.centerY - avatar.diameter / 2,
    avatar.diameter,
    avatar.diameter,
  );
}

function drawText(
  context: CanvasRenderingContext2D,
  value: string,
  xPercent: number,
  yPercent: number,
  fontSize: number,
  fill: string,
  stroke: string,
) {
  const x = (BIRTHDAY_CARD_PREVIEW_WIDTH * xPercent) / 100;
  const y = (BIRTHDAY_CARD_PREVIEW_HEIGHT * yPercent) / 100;
  context.save();
  context.font = `700 ${Math.round(fontSize)}px "Noto Sans CJK JP", "Noto Sans JP", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = birthdayCardTextStrokeWidth(fontSize);
  context.strokeStyle = stroke;
  context.fillStyle = fill;
  context.strokeText(value, x, y);
  context.fillText(value, x, y);
  context.restore();
}

function loadImage(
  url: string,
  crossOrigin: boolean,
  label: '背景画像' | 'Avatar',
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      image.src = '';
      reject(new Error(`${label}の読み込みがタイムアウトしました`));
    }, PREVIEW_IMAGE_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`${label}を読み込めませんでした`));
    };
    image.src = url;
  });
}
