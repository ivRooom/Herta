import sharp from 'sharp';
import type { MbtiAxis } from './mbti-core.js';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const MAX_CHARS_PER_LINE = 16;
const LINE_HEIGHT = 64;
/** 全カード共通のフラットな背景色。軸によって背景色は変えず、統一感を優先する。 */
const BACKGROUND_COLOR = '#17162a';

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

/**
 * 各軸を表す簡易アイコン(viewBox上の原点(0,0)中心、半径30px程度の範囲に収まる<g>断片)。
 * 外部アイコンライブラリを追加せず、手書きのSVGパスだけで表現する。
 */
const AXIS_ICONS: Record<MbtiAxis, (color: string) => string> = {
  EI: (color) => `
    <circle cx="-9" cy="0" r="16" fill="${color}" opacity="0.9"/>
    <circle cx="10" cy="0" r="16" fill="${color}" opacity="0.5"/>
  `,
  SN: (color) => `
    <path d="M -25 0 C -14 -16, 14 -16, 25 0 C 14 16, -14 16, -25 0 Z" fill="none" stroke="${color}" stroke-width="5"/>
    <circle cx="0" cy="0" r="8" fill="${color}"/>
  `,
  TF: (color) => `
    <line x1="-23" y1="-14" x2="23" y2="-14" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <line x1="0" y1="-14" x2="0" y2="16" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-23" cy="0" r="9.5" fill="none" stroke="${color}" stroke-width="5"/>
    <circle cx="23" cy="0" r="9.5" fill="none" stroke="${color}" stroke-width="5"/>
  `,
  JP: (color) => `
    <rect x="-21" y="-23" width="42" height="46" rx="8" fill="none" stroke="${color}" stroke-width="5"/>
    <line x1="-11" y1="-7" x2="11" y2="-7" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <path d="M -11 6 L -3 14 L 11 -5" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  `,
};

export interface MbtiQuestionCardInput {
  /** 0始まりの質問インデックス。 */
  questionIndex: number;
  totalQuestions: number;
  prompt: string;
  axis: MbtiAxis;
}

/** この文字の直後で改行すると読みやすい助詞・語尾。 */
const BREAK_AFTER_CHARS = new Set([
  'で',
  'と',
  'は',
  'が',
  'を',
  'に',
  'の',
  'も',
  'ば',
  'て',
  'だ',
  'ど',
  'り',
  'く',
  'ず',
  'ん',
]);

/**
 * 「が」は「〜が」(主語の助詞)であることが多いが、「上がる」「〜ながら」のように
 * 動詞語尾・接続助詞の一部として現れることもある。この組み合わせの直後で
 * 改行すると単語が分断されるため、区切り文字としては採用しない。
 */
function isSuppressedBreak(before: string, after: string | undefined): boolean {
  return before === 'が' && (after === 'る' || after === 'ら');
}

/** 行頭に来ると読みにくい(または不自然な)文字。小書き仮名・長音符・句読点など。 */
const AVOID_LINE_START_CHARS = new Set([
  'ゃ',
  'ゅ',
  'ょ',
  'っ',
  'ー',
  '、',
  '。',
  '！',
  '？',
  '」',
  '』',
  ')',
  '）',
]);

/** 行末(maxCharsPerLine)から何文字まで遡って自然な区切り位置を探すか。 */
const BREAK_SEARCH_WINDOW = 4;

/**
 * SVGの<text>は自動折返ししないため、CJK文字はおおむね等幅とみなして改行位置を
 * 決める簡易実装。maxCharsPerLineまで文字を詰めるが、その直前数文字以内に
 * 助詞などの自然な区切り文字があればそこで改行し、単語の途中(例:「安心」→
 * 「安」+「心」)や小書き仮名・句読点の直前で改行しないようにする。
 */
export function wrapJapaneseText(
  text: string,
  maxCharsPerLine: number = MAX_CHARS_PER_LINE,
): string[] {
  const chars = [...text];
  if (chars.length === 0) return [''];

  const lines: string[] = [];
  let start = 0;
  while (start < chars.length) {
    const maxEnd = Math.min(start + maxCharsPerLine, chars.length);
    if (maxEnd >= chars.length) {
      lines.push(chars.slice(start).join(''));
      break;
    }

    let breakAt = maxEnd;
    const windowStart = Math.max(start + 1, maxEnd - BREAK_SEARCH_WINDOW);
    for (let candidate = maxEnd; candidate >= windowStart; candidate--) {
      const before = chars[candidate - 1];
      const after = chars[candidate];
      if (
        before &&
        BREAK_AFTER_CHARS.has(before) &&
        (!after || !AVOID_LINE_START_CHARS.has(after)) &&
        !isSuppressedBreak(before, after)
      ) {
        breakAt = candidate;
        break;
      }
    }
    while (breakAt > start + 1 && AVOID_LINE_START_CHARS.has(chars[breakAt]!)) {
      breakAt -= 1;
    }

    lines.push(chars.slice(start, breakAt).join(''));
    start = breakAt;
  }
  return lines.length > 0 ? lines : [''];
}

export function buildMbtiQuestionCardSvg(input: MbtiQuestionCardInput): string {
  const total = Math.max(1, input.totalQuestions);
  const progress = Math.min(1, Math.max(0, (input.questionIndex + 1) / total));
  const percent = Math.round(progress * 100);
  const barX = 80;
  const barWidth = CARD_WIDTH - barX * 2;
  const barFillWidth = Math.max(24, Math.round(barWidth * progress));
  const axisColor = AXIS_COLORS[input.axis] ?? '#7c6df2';
  const axisIcon = AXIS_ICONS[input.axis]?.(axisColor) ?? '';
  const lines = wrapJapaneseText(input.prompt);
  const startY = CARD_HEIGHT / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;

  const textLines = lines
    .map(
      (line, index) =>
        `<text x="${CARD_WIDTH / 2}" y="${startY + index * LINE_HEIGHT}" text-anchor="middle" dominant-baseline="middle" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="48" font-weight="700" fill="#f5f5f7">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${BACKGROUND_COLOR}"/>

  <!-- カードパネルの枠 -->
  <rect x="24" y="24" width="${CARD_WIDTH - 48}" height="${CARD_HEIGHT - 48}" rx="24" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5"/>

  <!-- ヘッダー: アイコン + タイトル -->
  <g transform="translate(96,88)">${axisIcon}</g>
  <text x="140" y="80" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="28" font-weight="700" fill="#f5f5f7">MBTI風性格診断</text>
  <text x="140" y="106" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="19" fill="${axisColor}">${escapeXml(AXIS_LABELS[input.axis] ?? '')}</text>

  <!-- 進捗チップ -->
  <text x="${CARD_WIDTH - 80}" y="98" text-anchor="end" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="26" font-weight="700" fill="#f5f5f7">${input.questionIndex + 1} / ${total}</text>

  ${textLines}

  <!-- 進捗バー -->
  <rect x="${barX}" y="${CARD_HEIGHT - 104}" width="${barWidth}" height="10" rx="5" fill="#ffffff" opacity="0.12"/>
  <rect x="${barX}" y="${CARD_HEIGHT - 104}" width="${barFillWidth}" height="10" rx="5" fill="${axisColor}"/>
  <text x="${barX + barWidth}" y="${CARD_HEIGHT - 118}" text-anchor="end" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="18" fill="#9a97ad">${percent}%</text>

  <!-- ブランド表記 -->
  <text x="${barX}" y="${CARD_HEIGHT - 60}" font-family="Noto Sans CJK JP, Noto Sans CJK, sans-serif" font-size="16" fill="#6b6880" letter-spacing="1">ivRoom</text>
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
