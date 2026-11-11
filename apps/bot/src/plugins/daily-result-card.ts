import sharp from 'sharp';
import type { DailyQuizResult } from './daily-quiz-result-asset-selector.js';

/**
 * Shared building blocks for the Daily card family (bonus / question /
 * result). The palette, font stack and render bound intentionally mirror
 * daily-bonus-card.ts and daily-question-card.ts so those renderers can
 * converge on this module incrementally; this PR only adds the result card
 * on top of it (#803).
 */
export const DAILY_CARD_COLORS = {
  background: '#101620',
  accent: '#b9a2ff',
  text: '#e9e7f5',
  subtext: '#abb7c9',
  surface: '#242638',
} as const;
export const DAILY_CARD_FONT_FAMILY = 'Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif';

export function escapeDailyCardXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}

// Bound raster work across all Guilds. Busy renders fail fast so the caller
// can fall back to the canonical text without queuing.
let activeRenders = 0;
export async function withDailyCardRenderSlot<T>(render: () => Promise<T>): Promise<T> {
  if (activeRenders >= 2) throw new Error('DailyResultCardBusy');
  activeRenders++;
  try {
    return await render();
  } finally {
    activeRenders--;
  }
}

export interface DailyResultCardInput {
  result: DailyQuizResult;
  rewardPoints: number;
  balance: number;
  /** Pool artwork bytes fetched through the signed result-card media route. */
  artwork: Buffer;
}

const CARD_WIDTH = 1000;
const CARD_HEIGHT = 730;
const ARTWORK_X = 58;
const ARTWORK_Y = 104;
const ARTWORK_WIDTH = 884;
const ARTWORK_HEIGHT = 366;

/**
 * Upper bound on artwork frames composited into an animated result card.
 * Artwork with more frames is rendered as a still card from its first
 * frame instead of failing the reply.
 */
export const DAILY_RESULT_CARD_MAX_ANIMATED_FRAMES = 60;

function cardText(
  value: string,
  x: number,
  y: number,
  size = 26,
  color: string = DAILY_CARD_COLORS.text,
): string {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escapeDailyCardXml(value)}</text>`;
}

function cardBackgroundSvg(): string {
  return `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="32" fill="${DAILY_CARD_COLORS.background}"/>
      <rect x="22" y="22" width="956" height="686" rx="24" fill="none" stroke="${DAILY_CARD_COLORS.accent}" stroke-width="2"/>`;
}

/** Card chrome painted over the artwork window: header, window frame, outcome and points. */
function cardForegroundSvg(input: DailyResultCardInput): string {
  const points = `獲得：${input.rewardPoints.toLocaleString('ja-JP')} pt　保有：${input.balance.toLocaleString('ja-JP')} pt`;
  const pointsSize = Math.min(30, Math.floor(1600 / points.length));
  return `${cardText('HERTA  /  DAILY QUIZ RESULT', ARTWORK_X, 78, 24, DAILY_CARD_COLORS.accent)}
      <rect x="${ARTWORK_X}" y="${ARTWORK_Y}" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" rx="20" fill="none" stroke="${DAILY_CARD_COLORS.accent}" stroke-opacity="0.5"/>
      ${cardText(
        input.result === 'correct' ? '正解です！' : '今回は不正解です',
        ARTWORK_X,
        562,
        42,
        input.result === 'correct' ? DAILY_CARD_COLORS.accent : DAILY_CARD_COLORS.text,
      )}
      ${cardText(points, ARTWORK_X, 624, pointsSize)}
      ${cardText('結果は確定済みです。詳しくは Member ページで確認できます', ARTWORK_X, 678, 22, DAILY_CARD_COLORS.subtext)}`;
}

function cardSvg(body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">${body}</svg>`,
  );
}

async function renderStaticResultCard(input: DailyResultCardInput): Promise<Buffer> {
  const artwork = await sharp(input.artwork)
    .resize(ARTWORK_WIDTH, ARTWORK_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
      ${cardBackgroundSvg()}
      <defs>
        <clipPath id="artworkClip"><rect x="${ARTWORK_X}" y="${ARTWORK_Y}" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" rx="20"/></clipPath>
      </defs>
      <g font-family="${DAILY_CARD_FONT_FAMILY}">
      <image x="${ARTWORK_X}" y="${ARTWORK_Y}" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" clip-path="url(#artworkClip)" href="data:image/png;base64,${artwork.toString('base64')}"/>
      ${cardForegroundSvg(input)}
      </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Animated variant: the static chrome is rendered once as a background and
 * a transparent foreground layer, then every artwork frame is clipped to
 * the artwork window, sandwiched between the layers and joined into an
 * animated WebP that keeps the artwork's per-frame delays and loop count.
 */
async function renderAnimatedResultCard(
  input: DailyResultCardInput,
  pages: number,
  delays: readonly number[] | undefined,
  loop: number,
): Promise<Buffer> {
  const background = await sharp(cardSvg(cardBackgroundSvg())).png().toBuffer();
  const foreground = await sharp(
    cardSvg(`<g font-family="${DAILY_CARD_FONT_FAMILY}">${cardForegroundSvg(input)}</g>`),
  )
    .png()
    .toBuffer();
  const cornerMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}"><rect width="${ARTWORK_WIDTH}" height="${ARTWORK_HEIGHT}" rx="20" fill="#ffffff"/></svg>`,
  );
  const frames: Buffer[] = [];
  for (let page = 0; page < pages; page++) {
    const artwork = await sharp(input.artwork, { page })
      .resize(ARTWORK_WIDTH, ARTWORK_HEIGHT, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    const rounded = await sharp(artwork)
      .composite([{ input: cornerMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    frames.push(
      await sharp(background)
        .composite([
          { input: rounded, left: ARTWORK_X, top: ARTWORK_Y },
          { input: foreground, left: 0, top: 0 },
        ])
        .png()
        .toBuffer(),
    );
  }
  const delay = Array.from({ length: pages }, (_, i) => delays?.[i] ?? delays?.[0] ?? 100);
  return sharp(frames, { join: { animated: true } })
    .webp({ quality: 82, delay, loop })
    .toBuffer();
}

/**
 * Compose the answer-result card: the Admin-registered pool artwork framed
 * by the shared card chrome, plus the caller's own outcome and points.
 *
 * Secrecy: the renderer only receives the caller's own correctness and
 * points. It never sees the question prompt, the answer choices, the correct
 * option or any explanation, so none of them can leak into the image, its
 * metadata or its filename.
 */
export async function renderDailyResultCard(input: DailyResultCardInput): Promise<Buffer> {
  return withDailyCardRenderSlot(() => renderStaticResultCard(input));
}

export interface DailyResultCardRender {
  data: Buffer;
  /** Fixed, content-free attachment filename; the extension matches the encoding. */
  fileName: 'herta-daily-result.png' | 'herta-daily-result.webp';
}

/**
 * Render the result card as a Discord attachment. Animated artwork (an
 * animated GIF registered in Admin is stored as a multi-page WebP) produces
 * an animated WebP card; still artwork keeps the existing PNG card.
 * Artwork with more frames than DAILY_RESULT_CARD_MAX_ANIMATED_FRAMES falls
 * back to the still card rather than failing.
 */
export async function renderDailyResultCardAttachment(
  input: DailyResultCardInput,
): Promise<DailyResultCardRender> {
  return withDailyCardRenderSlot(async () => {
    const meta = await sharp(input.artwork, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    if (pages > 1 && pages <= DAILY_RESULT_CARD_MAX_ANIMATED_FRAMES) {
      const data = await renderAnimatedResultCard(input, pages, meta.delay, meta.loop ?? 0);
      return { data, fileName: 'herta-daily-result.webp' };
    }
    return { data: await renderStaticResultCard(input), fileName: 'herta-daily-result.png' };
  });
}
