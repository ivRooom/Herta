import {
  BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS,
  birthdayCardPreset,
  inspectBirthdayCardBackgroundImage,
  type BirthdayCardConfig,
} from '@herta/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';

const CARD_WIDTH = 1672;
const CARD_HEIGHT = 941;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_FETCH_TIMEOUT_MS = 5_000;
const DISCORD_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const SAFE_FALLBACK_BACKGROUND = { r: 119, g: 101, b: 143 } as const;

export interface BirthdayCardRenderInput {
  config: BirthdayCardConfig;
  displayName: string;
  avatarUrl: string | null;
  month: number;
  day: number;
  age: number | null;
  customBackground?: Uint8Array | null;
  /**
   * Background bytes fetched from the ivrm-web API's
   * card.backgroundUrl (#986 S5c), already download-validated by
   * the caller. When present and composable they win over the
   * Studio-stored custom background and the bundled preset.
   */
  remoteBackground?: Uint8Array | null;
  /**
   * Pre-fetched avatar image bytes, used instead of downloading
   * `avatarUrl`. For callers that cannot hand the renderer a
   * Discord CDN URL (the Studio preview endpoint passes its
   * bundled sample avatar, #991 S3d-D2). The bytes must be a
   * decodable image; the bot never sets this.
   */
  avatarBytes?: Uint8Array | null;
}

export async function renderBirthdayCard(input: BirthdayCardRenderInput): Promise<Buffer> {
  const preset = birthdayCardPreset(input.config.birthdayCardPreset);
  const layers: OverlayOptions[] = [];

  if (input.config.birthdayCardShowAvatar && (input.avatarUrl || input.avatarBytes)) {
    const avatarBytes = input.avatarBytes
      ? Buffer.from(input.avatarBytes)
      : await downloadDiscordAvatar(input.avatarUrl as string).catch(() => null);
    if (avatarBytes) {
      const diameter = Math.max(
        64,
        Math.round((CARD_WIDTH * input.config.birthdayCardAvatarSize) / 100),
      );
      const mask = Buffer.from(
        `<svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="white"/></svg>`,
      );
      const avatar = await sharp(avatarBytes, {
        limitInputPixels: BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS,
      })
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

  if (input.remoteBackground && inspectBirthdayCardBackgroundImage(input.remoteBackground)) {
    try {
      return await composeBirthdayCard(Buffer.from(input.remoteBackground), layers);
    } catch {
      // A payload that passed validation can still fail to compose;
      // continue to the Studio-stored background / preset chain
      // instead of dropping the birthday card delivery.
    }
  }

  if (
    (input.config.birthdayCardBackgroundSource === 'custom' ||
      input.config.birthdayCardBackgroundSource === 'asset') &&
    input.customBackground &&
    inspectBirthdayCardBackgroundImage(input.customBackground)
  ) {
    try {
      return await composeBirthdayCard(Buffer.from(input.customBackground), layers);
    } catch {
      // Header validation cannot prove that compressed image payloads are fully decodable.
      // Continue to the bundled preset instead of dropping the birthday card delivery.
    }
  }

  const presetBackground = await readPresetBackground(preset.assetFile);
  if (presetBackground && inspectBirthdayCardBackgroundImage(presetBackground)) {
    try {
      return await composeBirthdayCard(presetBackground, layers);
    } catch {
      // A corrupt packaged asset must not abort the birthday delivery cycle.
    }
  }

  return composeBirthdayCard(await createSafeFallbackBackground(), layers);
}

function composeBirthdayCard(background: Buffer, layers: OverlayOptions[]): Promise<Buffer> {
  return sharp(background, { limitInputPixels: BIRTHDAY_CARD_BACKGROUND_MAX_PIXELS })
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function readPresetBackground(presetAssetFile: string): Promise<Buffer | null> {
  for (const candidate of presetBackgroundCandidates(presetAssetFile)) {
    const bytes = await readFile(candidate).catch(() => null);
    if (bytes) return bytes;
  }
  return null;
}

/**
 * Preset asset lookup order. The canonical home is this package's
 * own assets directory; until the bundled WebP files are relocated
 * there, the byte-identical copies bundled with the bot and Studio
 * (kept identical by the preset-assets test) are used so the move
 * of the renderer into this package changes no rendered output.
 */
function presetBackgroundCandidates(presetAssetFile: string): string[] {
  const candidates = [
    `../assets/birthday-card-presets/${presetAssetFile}`,
    `../../../apps/bot/assets/birthday-card-presets/${presetAssetFile}`,
    `../../../apps/studio/public/birthday-card-presets/${presetAssetFile}`,
  ];
  return candidates.map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
}

function createSafeFallbackBackground(): Promise<Buffer> {
  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 3,
      background: SAFE_FALLBACK_BACKGROUND,
    },
  })
    .png()
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
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="${Math.round(fontSize)}" font-weight="700" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round">${escapeXml(value)}</text>`;
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
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
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
