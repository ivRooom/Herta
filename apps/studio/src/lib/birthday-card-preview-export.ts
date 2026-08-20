import { birthdayCardPreset, type BirthdayCardConfig } from '@herta/shared';
import {
  BIRTHDAY_CARD_PREVIEW_HEIGHT,
  BIRTHDAY_CARD_PREVIEW_WIDTH,
  birthdayCardAvatarGeometry,
  birthdayCardTextStrokeWidth,
} from './birthday-card-preview.ts';

const PREVIEW_IMAGE_TIMEOUT_MS = 10_000;

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
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Birthday Cardプレビューはブラウザでのみ生成できます');
  }

  const background = await loadImage(backgroundUrl);
  const cover = birthdayCardPreviewCoverRect(background.naturalWidth, background.naturalHeight);
  if (!cover) throw new Error('背景画像のサイズを取得できませんでした');

  const canvas = document.createElement('canvas');
  canvas.width = BIRTHDAY_CARD_PREVIEW_WIDTH;
  canvas.height = BIRTHDAY_CARD_PREVIEW_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Birthday Card描画機能を利用できません');

  context.drawImage(background, cover.x, cover.y, cover.width, cover.height);
  const preset = birthdayCardPreset(config.birthdayCardPreset);

  if (config.birthdayCardShowAvatar) {
    const avatar = birthdayCardAvatarGeometry(
      config.birthdayCardAvatarX,
      config.birthdayCardAvatarY,
      config.birthdayCardAvatarSize,
    );
    context.save();
    context.beginPath();
    context.arc(avatar.centerX, avatar.centerY, avatar.diameter / 2, 0, Math.PI * 2);
    context.fillStyle = '#6d5bd0';
    context.fill();
    context.lineWidth = Math.max(3, Math.round(avatar.diameter / 80));
    context.strokeStyle = '#ffffff';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `700 ${Math.max(28, Math.round(avatar.diameter * 0.24))}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('HM', avatar.centerX, avatar.centerY);
    context.restore();
  }

  if (config.birthdayCardShowName) {
    drawText(
      context,
      'Herta Member',
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
      '8月19日',
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
      '25歳',
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.src = '';
      reject(new Error('背景画像の読み込みがタイムアウトしました'));
    }, PREVIEW_IMAGE_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('背景画像を読み込めませんでした'));
    };
    image.src = url;
  });
}
