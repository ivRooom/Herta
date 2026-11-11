import sharp from 'sharp';

export interface DailyQuestionCardResult {
  state: 'pending' | 'graded' | 'void';
  isCorrect: boolean | null;
  selectedOptionIndex: number | null;
  selectedText: string | null;
  rewardPoints: number;
}

export interface DailyQuestionCardInput {
  slot: 'daily' | 'bonus';
  prompt: string;
  options: { label: string }[];
  format: 'choice2' | 'choice3' | 'choice4' | 'image_choice' | 'audio_choice' | 'free_text';
  maxTextLength: number;
  /** When present, the card renders the member's own answered state (#851 follow-up). */
  result?: DailyQuestionCardResult;
}

// Fixed 1920x1080 (16:9) canvas, redesigned after owner feedback on #851.
// v5 goes chalkboard: a flat wooden frame around a deep-green blackboard,
// chalk-white text, dashed chalk outlines for the choice rows, pastel chalk
// accents and sparse stroke-only doodles (stars, a heart, a swirl). Still
// flat — solid colors only, no gradients, glows, blur or shadow effects.
// No emoji/pictograph glyphs are used either — the production host fonts
// lack color emoji and rendered them as tofu boxes. Status and markers are
// drawn with SVG shapes (pills, circles, paths).
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME = '#9C6B43';
const FRAME_INNER = '#7C5233';
const BOARD = '#2E4B3F';
const CHALK = '#F7F3E6';
const CHALK_PINK = '#F2A7C3';
const CHALK_YELLOW = '#F5D76E';
const CHALK_BLUE = '#9AD0F5';
const CHALK_MINT = '#9FE8C1';
const SELECTED_FILL = '#EF8FB5';
const PILL_CORRECT = '#7ED6A5';
const PILL_NEUTRAL = '#8FAF9F';
const DARK = '#22392F';

const BOARD_X = 44;
const BOARD_Y = 44;
const BOARD_WIDTH = 1832;
const BOARD_HEIGHT = 992;
const LEFT_X = 140;
const LEFT_WIDTH = 830;
const RIGHT_X = 1040;
const RIGHT_WIDTH = 700;
const ROW_HEIGHT = 112;
const ROW_GAP = 36;
const ROWS_TOP = 330;
const ROWS_HEIGHT = 560;
const FOOTER_LINE_Y = 936;
const FOOTER_RIGHT = 1780;

// Bound raster work across all Guilds, same policy as daily-bonus-card.
// Busy renders throw and the caller falls back to the Embed presentation.
let activeRenders = 0;

function charWidth(codePoint: number, size: number) {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
    return size;
  return size * 0.55;
}

const textWidth = (value: string, size: number) =>
  [...value].reduce((sum, c) => sum + charWidth(c.codePointAt(0)!, size), 0);

/** Greedy wrap by rendered width; overflow is ellipsized so the card stays bounded. */
export function wrapCardText(
  value: string,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const widthOf = (line: string) =>
    [...line].reduce((sum, c) => sum + charWidth(c.codePointAt(0)!, size), 0);
  const all: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    let width = 0;
    for (const ch of paragraph) {
      const w = charWidth(ch.codePointAt(0)!, size);
      if (line && width + w > maxWidth) {
        all.push(line);
        line = '';
        width = 0;
      }
      line += ch;
      width += w;
    }
    all.push(line);
  }
  if (all.length <= maxLines) return all.length ? all : [''];
  const bounded = all.slice(0, maxLines);
  let last = bounded[maxLines - 1]!;
  while (last && widthOf(last) + size > maxWidth) last = [...last].slice(0, -1).join('');
  bounded[maxLines - 1] = `${last}…`;
  return bounded;
}

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Four-point sparkle (kirakira) as a flat path with concave curved sides. */
const sparklePath = (cx: number, cy: number, r: number) => {
  const q = r * 0.16;
  return (
    `M${cx} ${cy - r} Q${cx + q} ${cy - q} ${cx + r} ${cy} ` +
    `Q${cx + q} ${cy + q} ${cx} ${cy + r} ` +
    `Q${cx - q} ${cy + q} ${cx - r} ${cy} ` +
    `Q${cx - q} ${cy - q} ${cx} ${cy - r} Z`
  );
};

/** Five-point star as a flat polygon path. */
const starPath = (cx: number, cy: number, r: number) => {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(
      `${i === 0 ? 'M' : 'L'}${round2(cx + radius * Math.cos(angle))} ${round2(cy + radius * Math.sin(angle))}`,
    );
  }
  return points.join(' ') + ' Z';
};

/** Small flat heart. */
const heartPath = (cx: number, cy: number, s: number) =>
  `M${cx} ${cy + s * 0.85} ` +
  `C${cx - s * 1.35} ${cy - s * 0.05} ${cx - s * 0.7} ${cy - s} ${cx} ${cy - s * 0.3} ` +
  `C${cx + s * 0.7} ${cy - s} ${cx + s * 1.35} ${cy - s * 0.05} ${cx} ${cy + s * 0.85} Z`;

/** Tiny chalk x mark. */
const crossPath = (cx: number, cy: number, s: number) =>
  `M${cx - s} ${cy - s} L${cx + s} ${cy + s} M${cx + s} ${cy - s} L${cx - s} ${cy + s}`;

/** Small chalk swirl doodle (spiral made of shrinking arcs). */
const swirlPath = (cx: number, cy: number, r: number) => {
  const mid = round2(r * 0.62);
  const small = round2(r * 0.3);
  return (
    `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx} ${cy - r} ` +
    `A${mid} ${mid} 0 1 0 ${cx + mid} ${cy} A${small} ${small} 0 1 1 ${cx} ${cy + small}`
  );
};

/** Hand-drawn wavy underline for the title. */
const squigglePath = (x: number, width: number, y: number) => {
  const segments = Math.max(3, Math.round(width / 30));
  const step = width / segments;
  let d = `M${round2(x)} ${y}`;
  for (let i = 1; i <= segments; i++) {
    const cx = x + step * (i - 0.5);
    const cy = i % 2 === 1 ? y - 8 : y + 8;
    d += ` Q${round2(cx)} ${cy} ${round2(x + step * i)} ${y}`;
  }
  return d;
};

/**
 * Sparse chalk-dust specks on the board. Placement is a fixed-seed LCG so
 * the rendered card is deterministic.
 */
const chalkDust = () => {
  let seed = 20261111;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const specks: string[] = [];
  for (let i = 0; i < 44; i++) {
    const cx = BOARD_X + 24 + rand() * (BOARD_WIDTH - 48);
    const cy = BOARD_Y + 24 + rand() * (BOARD_HEIGHT - 48);
    const r = 1 + rand() * 2;
    const opacity = 0.04 + rand() * 0.06;
    specks.push(
      `<circle cx="${round2(cx)}" cy="${round2(cy)}" r="${round2(r)}" fill="${CHALK}" fill-opacity="${round2(opacity)}"/>`,
    );
  }
  return specks.join('');
};

/** Stroke-only chalk doodles sprinkled at the board corners and edges. */
const chalkDoodles = () =>
  [
    `<path d="${starPath(1790, 124, 15)}" fill="none" stroke="${CHALK_PINK}" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="${crossPath(1708, 172, 9)}" stroke="${CHALK_BLUE}" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="${heartPath(1818, 300, 10)}" fill="none" stroke="${CHALK_MINT}" stroke-width="3"/>`,
    `<path d="${crossPath(92, 560, 8)}" stroke="${CHALK_YELLOW}" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>`,
    `<path d="${swirlPath(96, 976, 11)}" fill="none" stroke="${CHALK}" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>`,
    `<path d="${starPath(1810, 968, 12)}" fill="none" stroke="${CHALK_YELLOW}" stroke-width="3" stroke-linejoin="round"/>`,
  ].join('');

interface StatusPill {
  text: string;
  fill: string;
  textColor: string;
  icon: 'check' | 'cross' | null;
}

function answeredStatusPill(result: DailyQuestionCardResult): StatusPill {
  if (result.state === 'pending')
    return { text: '結果待ち', fill: CHALK_YELLOW, textColor: DARK, icon: null };
  if (result.state === 'void')
    return { text: '無効化', fill: PILL_NEUTRAL, textColor: '#ffffff', icon: null };
  if (result.isCorrect === true)
    return { text: '正解', fill: PILL_CORRECT, textColor: DARK, icon: 'check' };
  if (result.isCorrect === false)
    return { text: '不正解', fill: CHALK_PINK, textColor: DARK, icon: 'cross' };
  return { text: '回答済み', fill: PILL_NEUTRAL, textColor: '#ffffff', icon: null };
}

function answeredFooterLine(result: DailyQuestionCardResult): string {
  if (result.state === 'pending') return '結果が確定したらお知らせします。';
  if (result.state === 'void') return 'ポイントは付与されません。';
  return '';
}

/**
 * Question card on a fixed 1920x1080 canvas (#851 redesign v5): chalkboard
 * styling — a wooden frame around a deep-green board, the prompt zone on
 * the left, dashed chalk choice rows on the right, and a footer band. When
 * `result` is present the selected choice row is filled with solid chalk
 * pink and marked with a drawn white heart.
 */
export function buildDailyQuestionCardSvg(input: DailyQuestionCardInput): string {
  const result = input.result;
  const parts: string[] = [];
  const text = (value: string, x: number, y: number, size = 30, color = CHALK, extra = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${extra}>${escapeXml(value)}</text>`;
  const bold = ' font-weight="700"';
  const xbold = ' font-weight="800"';

  // --- Wooden frame and chalkboard field ---
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${FRAME}"/>`);
  parts.push(
    `<rect x="28" y="28" width="${WIDTH - 56}" height="${HEIGHT - 56}" fill="${FRAME_INNER}"/>`,
  );
  parts.push(
    `<rect x="${BOARD_X}" y="${BOARD_Y}" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="${BOARD}"/>`,
  );
  parts.push(chalkDust());
  parts.push(chalkDoodles());

  // --- Left zone: eyebrow, title, status pill, prompt ---
  parts.push(
    `<path d="${heartPath(LEFT_X + 13, 158, 11)}" fill="none" stroke="${CHALK_PINK}" stroke-width="2.5"/>`,
  );
  parts.push(
    text('HERTA / DAILY QUESTION', LEFT_X + 40, 170, 28, CHALK_BLUE, `${bold} letter-spacing="6"`),
  );
  const title = input.slot === 'bonus' ? 'ボーナス問題' : '今日の問題';
  const titleX = LEFT_X + 52;
  parts.push(
    `<path d="${starPath(LEFT_X + 18, 238, 17)}" fill="none" stroke="${CHALK_YELLOW}" stroke-width="3" stroke-linejoin="round"/>`,
  );
  parts.push(text(title, titleX, 272, 84, CHALK, xbold));
  const titleWidth = textWidth(title, 84);
  parts.push(
    `<path d="${squigglePath(titleX + 2, titleWidth, 306)}" fill="none" stroke="${CHALK_YELLOW}" stroke-width="5" stroke-linecap="round"/>`,
  );
  if (result) {
    const pill = answeredStatusPill(result);
    const pillTop = 332;
    const pillHeight = 66;
    const pillCy = pillTop + pillHeight / 2;
    const iconSpace = pill.icon ? 42 : 0;
    const pillWidth = 36 + iconSpace + textWidth(pill.text, 34) + 36;
    parts.push(
      `<rect x="${LEFT_X}" y="${pillTop}" width="${pillWidth}" height="${pillHeight}" rx="33" fill="${pill.fill}"/>`,
    );
    if (pill.icon === 'check') {
      const ix = LEFT_X + 40;
      parts.push(
        `<path d="M${ix - 12} ${pillCy + 1} l9 10 l17 -21" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else if (pill.icon === 'cross') {
      const ix = LEFT_X + 40;
      parts.push(
        `<path d="M${ix - 10} ${pillCy - 10} l20 20 M${ix + 10} ${pillCy - 10} l-20 20" stroke="${DARK}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
      );
    }
    parts.push(text(pill.text, LEFT_X + 36 + iconSpace, pillCy + 12, 34, pill.textColor, bold));
  }
  parts.push(text('QUESTION', LEFT_X, 470, 27, CHALK_YELLOW, `${bold} letter-spacing="6"`));
  wrapCardText(input.prompt, 46, LEFT_WIDTH, 6).forEach((line, index) => {
    parts.push(text(line, LEFT_X, 548 + index * 62, 46));
  });

  // --- Right zone: dashed chalk choice rows or the free-text box ---
  const isFreeText = input.format === 'free_text' || !input.options.length;
  const zoneLabel = isFreeText ? 'ANSWER' : 'CHOICES';
  const zoneColor = isFreeText ? CHALK_BLUE : CHALK_PINK;
  parts.push(text(zoneLabel, RIGHT_X, 288, 27, zoneColor, `${bold} letter-spacing="6"`));
  const zoneLabelWidth = textWidth(zoneLabel, 27) + 6 * zoneLabel.length;
  parts.push(
    `<path d="${sparklePath(RIGHT_X + zoneLabelWidth + 34, 278, 10)}" fill="${CHALK_YELLOW}"/>`,
  );
  if (isFreeText) {
    parts.push(
      `<rect x="${RIGHT_X}" y="${ROWS_TOP}" width="${RIGHT_WIDTH}" height="${ROWS_HEIGHT}" rx="48" fill="none" stroke="${CHALK}" stroke-width="3" stroke-opacity="0.85" stroke-dasharray="14 10"/>`,
    );
    parts.push(
      text(result ? 'あなたの回答' : '回答方法', RIGHT_X + 48, ROWS_TOP + 88, 40, CHALK, bold),
    );
    const body = result
      ? (result.selectedText ?? '（回答なし）')
      : `下のボタンから自由記述で回答してください（最大${input.maxTextLength}文字）`;
    wrapCardText(body, 34, RIGHT_WIDTH - 96, 7).forEach((line, index) => {
      parts.push(
        text(line, RIGHT_X + 48, ROWS_TOP + 158 + index * 54, 34, CHALK, result ? bold : ''),
      );
    });
  } else {
    const rows = input.options.slice(0, 4);
    const totalHeight = rows.length * ROW_HEIGHT + (rows.length - 1) * ROW_GAP;
    const startY = ROWS_TOP + (ROWS_HEIGHT - totalHeight) / 2;
    rows.forEach((option, index) => {
      const rowY = startY + index * (ROW_HEIGHT + ROW_GAP);
      const rowCy = rowY + ROW_HEIGHT / 2;
      const selected = result?.selectedOptionIndex === index;
      const dimmed = result && !selected;
      parts.push(
        selected
          ? `<rect x="${RIGHT_X}" y="${rowY}" width="${RIGHT_WIDTH}" height="${ROW_HEIGHT}" rx="40" fill="${SELECTED_FILL}" stroke="#ffffff" stroke-width="3.5"/>`
          : `<rect x="${RIGHT_X}" y="${rowY}" width="${RIGHT_WIDTH}" height="${ROW_HEIGHT}" rx="40" fill="none" stroke="${CHALK}" stroke-width="3" stroke-opacity="0.85" stroke-dasharray="14 10"/>`,
      );
      if (selected) {
        parts.push(`<path d="${heartPath(RIGHT_X + 38, rowCy - 2, 13)}" fill="#ffffff"/>`);
        parts.push(`<circle cx="${RIGHT_X + 102}" cy="${rowCy}" r="30" fill="#ffffff"/>`);
        parts.push(
          text(
            String(index + 1),
            RIGHT_X + 102,
            rowCy + 13,
            36,
            SELECTED_FILL,
            `${bold} text-anchor="middle"`,
          ),
        );
      } else {
        const chipOpacity = dimmed ? ' opacity="0.55"' : '';
        parts.push(
          `<circle cx="${RIGHT_X + 102}" cy="${rowCy}" r="30" fill="none" stroke="${CHALK}" stroke-width="3"${chipOpacity}/>`,
        );
        parts.push(
          text(
            String(index + 1),
            RIGHT_X + 102,
            rowCy + 13,
            36,
            CHALK,
            `${bold} text-anchor="middle"${chipOpacity}`,
          ),
        );
      }
      const labelLines = wrapCardText(option.label, 38, RIGHT_WIDTH - 190, 2);
      const firstBaseline = labelLines.length > 1 ? rowY + 47 : rowY + 70;
      labelLines.forEach((line, lineIndex) => {
        parts.push(
          text(
            line,
            RIGHT_X + 158,
            firstBaseline + lineIndex * 46,
            38,
            selected ? '#ffffff' : CHALK,
            `${selected ? bold : ' font-weight="600"'}${dimmed ? ' opacity="0.55"' : ''}`,
          ),
        );
      });
    });
  }

  // --- Footer band ---
  parts.push(
    `<path d="M${LEFT_X} ${FOOTER_LINE_Y} H${FOOTER_RIGHT}" stroke="${CHALK}" stroke-width="2.5" stroke-opacity="0.5" stroke-dasharray="10 8"/>`,
  );
  const footerText = result
    ? answeredFooterLine(result)
    : '回答は下のボタンから。番号は選択肢と対応しています。';
  if (footerText) parts.push(text(footerText, LEFT_X + 16, 992, 29, CHALK, ' fill-opacity="0.75"'));
  if (result && result.state === 'graded') {
    const chipText = `獲得 ${result.rewardPoints}pt`;
    const chipWidth = 62 + textWidth(chipText, 32) + 32;
    const chipX = FOOTER_RIGHT - chipWidth;
    parts.push(
      `<rect x="${chipX}" y="942" width="${chipWidth}" height="58" rx="29" fill="${CHALK_YELLOW}"/>`,
    );
    parts.push(`<path d="${starPath(chipX + 34, 971, 11)}" fill="${DARK}"/>`);
    parts.push(text(chipText, chipX + 62, 983, 32, DARK, bold));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <g font-family="Yusei Magic, Kaisei Decol, M PLUS Rounded 1c, Noto Sans CJK JP, Noto Sans JP, sans-serif">
      ${parts.join('\n      ')}
      </g></svg>`;
}

export async function renderDailyQuestionCard(input: DailyQuestionCardInput): Promise<Buffer> {
  if (activeRenders >= 2) throw new Error('DailyQuestionCardBusy');
  activeRenders++;
  try {
    return await sharp(Buffer.from(buildDailyQuestionCardSvg(input)))
      .png()
      .toBuffer();
  } finally {
    activeRenders--;
  }
}
