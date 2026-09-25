import sharp from 'sharp';
import type { MbtiAxis } from './mini-games-mbti-core.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const MAX_CHARS_PER_LINE = 16;
const LINE_HEIGHT = 64;

const AXIS_LABELS: Record<MbtiAxis, string> = {
  EI: '外向性 (E) / 内向性 (I)',
  SN: '感覚 (S) / 直観 (N)',
  TF: '思考 (T) / 感情 (F)',
  JP: '判断 (J) / 知覚 (P)',
};

const AXIS_COLORS: Record<MbtiAxis, string> = {
  EI: '#f97316',
  SN: '#22c55e',
  TF: '#38bdf8',
  JP: '#a855f7',
};

export interface MbtiQuestionCardInput {
  /** 0始まりの質問インデックス。 */
  questionIndex: number;
  totalQuestions: number;
  prompt: string;
  axis: MbtiAxis;
}

/**
 * SVGの<text>は自動折返ししないため、CJK文字はおおむね等幅とみなして文字数で
 * 折り返す。英数字混じりでも大きく崩れない程度の簡易実装。
 */
export function wrapJapaneseText(
  text: string,
  maxCharsPerLine: number = MAX_CHARS_PER_LINE,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const character of text) {
    current += character;
    if (current.length >= maxCharsPerLine) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function buildMbtiQuestionCardSvg(input: MbtiQuestionCardInput): string {
  const total = Math.max(1, input.totalQuestions);
  const progress = Math.min(1, Math.max(0, (input.questionIndex + 1) / total));
  const barX = 80;
  const barWidth = CARD_WIDTH - barX * 2;
  const barFillWidth = Math.max(24, Math.round(barWidth * progress));
  const axisColor = AXIS_COLORS[input.axis] ?? '#7c6df2';
  const lines = wrapJapaneseText(input.prompt);
  const startY = CARD_HEIGHT / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;

  const textLines = lines
    .map(
      (line, index) =>
        `<text x="${CARD_WIDTH / 2}" y="${startY + index * LINE_HEIGHT}" text-anchor="middle" dominant-baseline="middle" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="48" font-weight="700" fill="#f8fafc">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e1b3a"/>
      <stop offset="100%" stop-color="#3d3166"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>
  <text x="80" y="90" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="34" font-weight="700" fill="${axisColor}">MBTI風性格診断</text>
  <text x="${CARD_WIDTH - 80}" y="90" text-anchor="end" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="32" fill="#cbd5f5">${input.questionIndex + 1} / ${total}</text>
  ${textLines}
  <text x="${barX}" y="${CARD_HEIGHT - 130}" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="26" fill="#94a3b8">${escapeXml(AXIS_LABELS[input.axis] ?? '')}</text>
  <rect x="${barX}" y="${CARD_HEIGHT - 100}" width="${barWidth}" height="24" rx="12" fill="#312a56"/>
  <rect x="${barX}" y="${CARD_HEIGHT - 100}" width="${barFillWidth}" height="24" rx="12" fill="${axisColor}"/>
</svg>`;
}

export async function renderMbtiQuestionCard(input: MbtiQuestionCardInput): Promise<Buffer> {
  const svg = buildMbtiQuestionCardSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
