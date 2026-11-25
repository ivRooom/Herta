import sharp, { type OverlayOptions } from 'sharp';

/**
 * Deco profile card renderer (#1002, ivrm-web Epic #1837 S4):
 * the Discord profile card that reflects the member's equipped
 * deco — cover as the background, card skin as the base paper,
 * frame composited over the avatar, title (称号) and today's
 * omikuji fortune badge. Canvas is 1672x941, the same size as
 * the birthday card (@herta/birthday-card), so the two cards
 * behave identically in Discord clients.
 *
 * Layer order (every image layer is fail-soft: a missing or
 * undecodable image drops only its own layer):
 *   1. cover image (fit: cover) — else the card skin — else a
 *      generated gradient paper
 *   2. card skin composited full-card when the cover is the base
 *   3. circular avatar, then the frame image over it
 *   4. SVG text: display name, title pill, fortune badge pill
 *
 * The theme slot is a Web-only accent (design D7/D8) and is
 * intentionally not rendered here.
 */

export const DECO_CARD_WIDTH = 1672;
export const DECO_CARD_HEIGHT = 941;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const FETCH_TIMEOUT_MS = 5_000;

const AVATAR_DIAMETER = 400;
const AVATAR_LEFT = 118;
const AVATAR_TOP = 270;
const FRAME_SIZE = 484;
const TEXT_LEFT = 640;

export interface DecoProfileCardInput {
  displayName: string;
  /** Pre-fetched avatar bytes (Discord CDN), already validated. */
  avatarBytes?: Buffer | null;
  /** Pre-fetched equipped cover image bytes. */
  coverBytes?: Buffer | null;
  /** Pre-fetched equipped card-skin image bytes. */
  skinBytes?: Buffer | null;
  /** Pre-fetched equipped frame image bytes. */
  frameBytes?: Buffer | null;
  /** Equipped title (称号) name, or null when no title is set. */
  titleName: string | null;
  /** Today's omikuji fortune label (e.g. 大吉), or null. */
  fortuneLabel: string | null;
  /** Accent color for the fortune badge (hex like #f5c542). */
  fortuneColor?: string | null;
}

/**
 * Downloads an Admin-registered deco item image (or a Discord
 * avatar) for the card. Only https URLs are accepted (including
 * after redirects), the body is read under a byte cap, and the
 * bytes must survive a real sharp decode before they are
 * trusted. Every failure resolves to null so the caller drops
 * just that layer. The URL is never logged.
 *
 * Item image URLs may also be site-relative paths (the Admin
 * accepts "/..." values); the bot has no canonical origin for
 * those, so they resolve to null here and the layer is skipped.
 */
export async function fetchDecoCardImage(urlValue: string | null): Promise<Buffer | null> {
  if (!urlValue) return null;
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.body) return null;
  if (response.url) {
    try {
      if (new URL(response.url).protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;

  const bytes = await readBoundedBody(response.body);
  if (!bytes) return null;
  try {
    await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).resize(1, 1).toBuffer();
  } catch {
    return null;
  }
  return bytes;
}

async function readBoundedBody(body: ReadableStream<Uint8Array>): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

export async function renderDecoProfileCard(input: DecoProfileCardInput): Promise<Buffer> {
  const base = await buildBase(input);
  const layers: OverlayOptions[] = [];

  if (input.coverBytes && input.skinBytes) {
    const skin = await resizeOverlay(input.skinBytes, DECO_CARD_WIDTH, DECO_CARD_HEIGHT);
    if (skin) layers.push({ input: skin, left: 0, top: 0 });
  }

  if (input.avatarBytes) {
    const avatar = await buildAvatar(input.avatarBytes);
    if (avatar) {
      layers.push({ input: avatar, left: AVATAR_LEFT, top: AVATAR_TOP });
    }
    if (input.frameBytes) {
      const frame = await resizeOverlay(input.frameBytes, FRAME_SIZE, FRAME_SIZE);
      if (frame) {
        layers.push({
          input: frame,
          left: AVATAR_LEFT + Math.round((AVATAR_DIAMETER - FRAME_SIZE) / 2),
          top: AVATAR_TOP + Math.round((AVATAR_DIAMETER - FRAME_SIZE) / 2),
        });
      }
    }
  }

  layers.push({ input: Buffer.from(renderTextOverlay(input)), left: 0, top: 0 });

  return sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

async function buildBase(input: DecoProfileCardInput): Promise<Buffer> {
  for (const candidate of [input.coverBytes, input.skinBytes]) {
    if (!candidate) continue;
    try {
      return await sharp(candidate, { limitInputPixels: MAX_IMAGE_PIXELS })
        .resize(DECO_CARD_WIDTH, DECO_CARD_HEIGHT, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
    } catch {
      // Fall through to the next base candidate / gradient paper.
    }
  }
  return sharp(Buffer.from(fallbackPaperSvg())).png().toBuffer();
}

function fallbackPaperSvg(): string {
  return `<svg width="${DECO_CARD_WIDTH}" height="${DECO_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d2440"/><stop offset="0.55" stop-color="#2c2a55"/><stop offset="1" stop-color="#3d2f5e"/></linearGradient></defs><rect width="${DECO_CARD_WIDTH}" height="${DECO_CARD_HEIGHT}" fill="url(#paper)"/></svg>`;
}

async function buildAvatar(bytes: Buffer): Promise<Buffer | null> {
  try {
    const mask = Buffer.from(
      `<svg width="${AVATAR_DIAMETER}" height="${AVATAR_DIAMETER}" xmlns="http://www.w3.org/2000/svg"><circle cx="${AVATAR_DIAMETER / 2}" cy="${AVATAR_DIAMETER / 2}" r="${AVATAR_DIAMETER / 2}" fill="white"/></svg>`,
    );
    return await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .resize(AVATAR_DIAMETER, AVATAR_DIAMETER, { fit: 'cover' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function resizeOverlay(bytes: Buffer, width: number, height: number): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .resize(width, height, { fit: 'fill' })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function renderTextOverlay(input: DecoProfileCardInput): string {
  const elements: string[] = [];
  elements.push(
    `<text x="${TEXT_LEFT}" y="440" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="82" font-weight="700" fill="#ffffff" stroke="rgba(10,10,30,0.55)" stroke-width="6" paint-order="stroke fill" stroke-linejoin="round">${escapeXml(truncateText(input.displayName, 24))}</text>`,
  );
  if (input.titleName) {
    elements.push(pill(TEXT_LEFT, 492, `称号 ${truncateText(input.titleName, 20)}`, '#ffd166'));
  }
  if (input.fortuneLabel) {
    const label = `今日の運勢 ${input.fortuneLabel}`;
    const width = pillWidth(label, 40);
    elements.push(
      pill(DECO_CARD_WIDTH - 72 - width, 64, label, input.fortuneColor ?? '#f5c542', 40),
    );
  }
  elements.push(
    `<text x="${DECO_CARD_WIDTH - 72}" y="${DECO_CARD_HEIGHT - 56}" text-anchor="end" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="30" fill="rgba(255,255,255,0.75)">ivRooom プロフィールカード</text>`,
  );
  return `<svg width="${DECO_CARD_WIDTH}" height="${DECO_CARD_HEIGHT}" viewBox="0 0 ${DECO_CARD_WIDTH} ${DECO_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${elements.join('')}</svg>`;
}

/** A rounded label pill with dark translucent backing. */
function pill(x: number, y: number, label: string, color: string, fontSize = 44): string {
  const width = pillWidth(label, fontSize);
  const height = Math.round(fontSize * 1.7);
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.round(height / 2)}" fill="rgba(8,8,24,0.62)"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="central" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="${fontSize}" font-weight="700" fill="${color}">${escapeXml(label)}</text></g>`;
}

function pillWidth(label: string, fontSize: number): number {
  let width = fontSize * 1.2;
  for (const char of label) {
    width += char.codePointAt(0)! > 0x2e7f ? fontSize : fontSize * 0.56;
  }
  return Math.round(width);
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim() || 'Member';
  const chars = Array.from(normalized);
  return chars.length <= maxLength ? normalized : `${chars.slice(0, maxLength - 1).join('')}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
