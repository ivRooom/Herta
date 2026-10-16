import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import type { DailyFortune } from './fortune-core.js';

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}
function wrap(value: string, size: number): string[] {
  const chars = Array.from(value);
  return Array.from({ length: Math.ceil(chars.length / size) }, (_, i) =>
    chars.slice(i * size, (i + 1) * size).join(''),
  );
}

/** Shared cards deliberately omit date of birth, age, blood type and profile notes. */
export async function renderFortuneCard(
  fortune: DailyFortune,
  displayName: string,
  mbti: string | null,
): Promise<Buffer> {
  const text = (value: string, x: number, y: number, size = 28, color = '#e9e7f5') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${escapeXml(value)}</text>`;
  const types = [
    'INTJ',
    'INTP',
    'ENTJ',
    'ENTP',
    'INFJ',
    'INFP',
    'ENFJ',
    'ENFP',
    'ISTJ',
    'ISFJ',
    'ESTJ',
    'ESFJ',
    'ISTP',
    'ISFP',
    'ESTP',
    'ESFP',
  ];
  const index = Math.max(0, types.indexOf(mbti?.slice(0, 4) ?? 'INFJ'));
  let illustration: Buffer | null = null;
  try {
    illustration = await sharp(
      fileURLToPath(new URL('../../assets/fortune/herta-doodles-v3.webp', import.meta.url)),
    )
      .extract({
        left: (index % 4) * 320,
        top: Math.floor(index / 4) * 320,
        width: 320,
        height: 320,
      })
      .resize(330, 330)
      .png()
      .toBuffer();
  } catch {
    /* A missing decorative asset must not prevent the complete fortune card. */
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1420">
    <rect width="1200" height="1420" rx="40" fill="#101620"/>
    <rect x="34" y="34" width="1132" height="1352" rx="34" fill="none" stroke="${fortune.hex}" stroke-width="2"/>
    <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
    ${text('HERTA  /  DAILY FORTUNE', 76, 105, 28, fortune.hex)}
    ${text(fortune.date, 76, 162, 26)}
    ${text(`${Array.from(displayName).slice(0, 18).join('')} さんの今日の運勢`, 76, 225, 32)}
    ${text('総合運', 76, 302, 28)}
    ${text('★'.repeat(fortune.stars) + '☆'.repeat(5 - fortune.stars), 76, 374, 57, fortune.hex)}
    ${text(fortune.title, 76, 455, 36, fortune.hex)}
    ${wrap(fortune.message, 35)
      .map((line, i) => text(line, 76, 514 + i * 44))
      .join('')}
    ${fortune.categories.map((item, i) => `${text(item.name, 86, 685 + i * 57, 27)}${text('★'.repeat(item.stars) + '☆'.repeat(5 - item.stars), 500, 685 + i * 57, 31, fortune.hex)}${text(item.advice, 86, 710 + i * 57, 20, '#abb7c9')}`).join('')}
    <path d="M76 970 Q580 955 1120 970" fill="none" stroke="${fortune.hex}" stroke-width="2" stroke-dasharray="8 8"/>
    <circle cx="95" cy="1024" r="13" fill="${fortune.hex}"/>
    ${text(`ラッキーカラー：${fortune.color}`, 125, 1035, 29)}
    ${text(`ラッキーアイテム：${fortune.item}`, 76, 1092, 29)}
    ${text(`ラッキーナンバー：${fortune.luckyNumber}  /  時間帯：${fortune.luckyTime}`, 76, 1149, 29)}
    ${text('今日のアクション', 76, 1213, 26, fortune.hex)}
    ${text(fortune.action, 76, 1260, 29)}
    ${wrap(fortune.disclaimer, 48)
      .map((line, i) => text(line, 76, 1320 + i * 29, 20, '#abb7c9'))
      .join('')}
    </g></svg>`;
  return sharp(Buffer.from(svg))
    .composite(illustration ? [{ input: illustration, left: 790, top: 140 }] : [])
    .png()
    .toBuffer();
}
