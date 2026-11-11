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
  return withDailyCardRenderSlot(async () => {
    const artwork = await sharp(input.artwork)
      .resize(884, 366, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    const text = (
      value: string,
      x: number,
      y: number,
      size = 26,
      color: string = DAILY_CARD_COLORS.text,
    ) =>
      `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escapeDailyCardXml(value)}</text>`;
    const points = `獲得：${input.rewardPoints.toLocaleString('ja-JP')} pt　保有：${input.balance.toLocaleString('ja-JP')} pt`;
    const pointsSize = Math.min(30, Math.floor(1600 / points.length));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="730">
      <rect width="1000" height="730" rx="32" fill="${DAILY_CARD_COLORS.background}"/>
      <rect x="22" y="22" width="956" height="686" rx="24" fill="none" stroke="${DAILY_CARD_COLORS.accent}" stroke-width="2"/>
      <defs>
        <clipPath id="artworkClip"><rect x="58" y="104" width="884" height="366" rx="20"/></clipPath>
      </defs>
      <g font-family="${DAILY_CARD_FONT_FAMILY}">
      ${text('HERTA  /  DAILY QUIZ RESULT', 58, 78, 24, DAILY_CARD_COLORS.accent)}
      <image x="58" y="104" width="884" height="366" clip-path="url(#artworkClip)" href="data:image/png;base64,${artwork.toString('base64')}"/>
      <rect x="58" y="104" width="884" height="366" rx="20" fill="none" stroke="${DAILY_CARD_COLORS.accent}" stroke-opacity="0.5"/>
      ${text(
        input.result === 'correct' ? '正解です！' : '今回は不正解です',
        58,
        562,
        42,
        input.result === 'correct' ? DAILY_CARD_COLORS.accent : DAILY_CARD_COLORS.text,
      )}
      ${text(points, 58, 624, pointsSize)}
      ${text('結果は確定済みです。詳しくは Member ページで確認できます', 58, 678, 22, DAILY_CARD_COLORS.subtext)}
      </g></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  });
}
