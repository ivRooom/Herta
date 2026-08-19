import {
  birthdayCardPreset,
  type BirthdayCardConfig,
} from '@herta/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CARD_WIDTH = 1672;
const CARD_HEIGHT = 941;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 5_000;
const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

export interface BirthdayCardRenderInput {
  config: BirthdayCardConfig;
  displayName: string;
  avatarUrl: string | null;
  month: number;
  day: number;
  age: number | null;
}

export async function renderBirthdayCard(input: BirthdayCardRenderInput): Promise<Buffer> {
  const preset = birthdayCardPreset(input.config.birthdayCardPreset);
  const backgroundPath = fileURLToPath(
    new URL(`../../assets/birthday-card-presets/${preset.assetFile}`, import.meta.url),
  );
  const background = await readFile(backgroundPath);
  const layers: sharp.OverlayOptions[] = [];

  if (input.config.birthdayCardShowAvatar && input.avatarUrl) {
    const avatarBytes = await downloadDiscordAvatar(input.avatarUrl).catch(() => null);
    if (avatarBytes) {
      const diameter = Math.max(
        64,
        Math.round((CARD_WIDTH * input.config.birthdayCardAvatarSize) / 100),
      );
      const mask = Buffer.from(
        `<svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="white"/></svg>`,
      );
      const avatar = await sharp(avatarBytes)
        .resize(diameter, diameter, { fit: 'cover' })
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
      layers.push({
        input: avatar,
        left: centeredLeft(input.config.birthdayCardAvatarX, diameter),
        top: centeredTop(input.config.birthdayCardAvatarY, diameter),
      });
    }
  }

  layers.push({
    input: Buffer.from(renderTextOverlay(input, preset.textColor, preset.textStroke)),
    left: 0,
    top: 0,
  });

  return sharp(background)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'fill' })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function renderTextOverlay(
  input: BirthdayCardRenderInput,
  textColor: string,
  textStroke: string,
): string {
  const elements: string[] = [];
  if (input.config.birthdayCardShowName) {
    elements.push(
      textElement(
        truncateText(input.displayName, 32),
        input.config.birthdayCardNameX,
        input.config.birthdayCardNameY,
        input.config.birthdayCardNameSize,
        textColor,
        textStroke,
      ),
    );
  }
  if (input.config.birthdayCardShowBirthday) {
    elements.push(
      textElement(
        `${input.month}月${input.day}日`,
        input.config.birthdayCardBirthdayX,
        input.config.birthdayCardBirthdayY,
        input.config.birthdayCardBirthdaySize,
        textColor,
        textStroke,
      ),
    );
  }
  if (input.config.birthdayCardShowAge && input.age !== null) {
    elements.push(
      textElement(
        `${input.age}歳`,
        input.config.birthdayCardAgeX,
        input.config.birthdayCardAgeY,
        input.config.birthdayCardAgeSize,
        textColor,
        textStroke,
      ),
    );
  }

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${elements.join('')}</svg>`;
}

function textElement(
  value: string,
  xPercent: number,
  yPercent: number,
  fontSize: number,
  fill: string,
  stroke: string,
): string {
  const x = Math.round((CARD_WIDTH * xPercent) / 100);
  const y = Math.round((CARD_HEIGHT * yPercent) / 100);
  const strokeWidth = Math.max(2, Math.round(fontSize / 18));
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Noto Sans JP, DejaVu Sans, sans-serif" font-size="${Math.round(fontSize)}" font-weight="700" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round">${escapeXml(value)}</text>`;
}

async function downloadDiscordAvatar(urlValue: string): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !DISCORD_CDN_HOSTS.has(url.hostname)) return null;

  const response = await fetch(url, { signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
  if (!response.ok || !response.body) return null;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('image/')) return null;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AVATAR_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function centeredLeft(xPercent: number, width: number): number {
  return clamp(Math.round((CARD_WIDTH * xPercent) / 100 - width / 2), 0, CARD_WIDTH - width);
}

function centeredTop(yPercent: number, height: number): number {
  return clamp(Math.round((CARD_HEIGHT * yPercent) / 100 - height / 2), 0, CARD_HEIGHT - height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim() || 'Member';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
