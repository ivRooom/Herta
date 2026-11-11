import sharp from 'sharp';

export interface DailyQuestionCardInput {
  slot: 'daily' | 'bonus';
  prompt: string;
  options: { label: string }[];
  format: 'choice2' | 'choice3' | 'choice4' | 'image_choice' | 'audio_choice' | 'free_text';
  maxTextLength: number;
}

const WIDTH = 1000;
const MARGIN = 58;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

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

/**
 * Question card with an explicit boundary between the prompt section and the
 * numbered options section, in the daily-bonus-card palette (#851).
 */
export function buildDailyQuestionCardSvg(input: DailyQuestionCardInput): string {
  const parts: string[] = [];
  const text = (value: string, x: number, y: number, size = 26, color = '#e9e7f5') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escapeXml(value)}</text>`;
  const divider = (y: number) =>
    `<path d="M${MARGIN} ${y} H${WIDTH - MARGIN}" stroke="#b9a2ff" stroke-opacity="0.4"/>`;

  let cursor = 78;
  parts.push(text('HERTA  /  DAILY QUESTION', MARGIN, cursor, 24, '#b9a2ff'));
  cursor += 52;
  parts.push(text(input.slot === 'bonus' ? 'ボーナス問題' : '今日の問題', MARGIN, cursor, 36));
  cursor += 34;
  parts.push(divider(cursor));

  cursor += 48;
  parts.push(text('❓ 問題', MARGIN, cursor, 26, '#b9a2ff'));
  cursor += 50;
  for (const line of wrapCardText(input.prompt, 30, CONTENT_WIDTH, 8)) {
    parts.push(text(line, MARGIN, cursor, 30));
    cursor += 44;
  }
  cursor += 6;
  parts.push(divider(cursor));

  cursor += 48;
  if (input.format === 'free_text' || !input.options.length) {
    parts.push(text('✍ 回答方法', MARGIN, cursor, 26, '#b9a2ff'));
    cursor += 48;
    for (const line of wrapCardText(
      `下のボタンから自由記述で回答してください（最大${input.maxTextLength}文字）`,
      26,
      CONTENT_WIDTH,
      3,
    )) {
      parts.push(text(line, MARGIN, cursor, 26));
      cursor += 38;
    }
  } else {
    parts.push(text('🔢 選択肢', MARGIN, cursor, 26, '#b9a2ff'));
    cursor += 50;
    input.options.forEach((option, index) => {
      const lines = wrapCardText(option.label, 28, CONTENT_WIDTH - 44, 3);
      lines.forEach((line, lineIndex) => {
        parts.push(
          lineIndex === 0
            ? text(`${index + 1}.  ${line}`, MARGIN, cursor, 28)
            : text(line, MARGIN + 44, cursor, 28),
        );
        cursor += 40;
      });
      cursor += 12;
    });
    cursor -= 12;
  }
  cursor += 10;
  parts.push(divider(cursor));
  cursor += 44;
  parts.push(
    text('回答は下のボタンから。番号は選択肢と対応しています。', MARGIN, cursor, 22, '#abb7c9'),
  );
  const height = cursor + 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
      <rect width="${WIDTH}" height="${height}" rx="32" fill="#101620"/>
      <rect x="22" y="22" width="${WIDTH - 44}" height="${height - 44}" rx="24" fill="none" stroke="#b9a2ff" stroke-width="2"/>
      <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
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
