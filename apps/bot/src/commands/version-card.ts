import sharp from 'sharp';

export interface VersionCardModel {
  /** 表示用の短縮 SHA（先頭7桁）。記録されていない場合は null。 */
  shortSha: string | null;
  /** 完全なコミット SHA。記録されていない場合は null。 */
  commitSha: string | null;
  /** 環境ラベル（例: 本番）。 */
  environmentLabel: string;
  /** 起動時刻の表示文字列（JST）。 */
  startedAtLabel: string;
  /** 稼働時間の表示文字列。 */
  uptimeLabel: string;
  /** Node.js バージョン文字列。 */
  nodeVersion: string;
}

const ACCENT = '#7c6df2';
const TEXT_MAIN = '#e9e7f5';
const TEXT_SUB = '#abb7c9';
const DIVIDER = '#2b3245';

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

/** 起動時刻を JST の表示文字列へ整形する（例: 2026/11/13（金）16:27） */
export function formatStartedAtJa(startedAt: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(startedAt);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')}（${get('weekday')}）${get('hour')}:${get('minute')}`;
}

/** Bot のバージョン情報カードを PNG で描く（Minecraft Status カードと同じ SVG → sharp 方式） */
export async function renderVersionCard(model: VersionCardModel): Promise<Buffer> {
  const width = 1200;
  const pad = 64;
  const parts: string[] = [];
  let y = 0;

  const text = (value: string, x: number, yy: number, size = 28, color = TEXT_MAIN, weight = '') =>
    `<text x="${x}" y="${yy}" font-size="${size}" fill="${color}"${weight ? ` font-weight="${weight}"` : ''}>${escapeXml(value)}</text>`;

  // ヘッダー: アクセントドット + タイトル
  y += 92;
  parts.push(`<circle cx="${pad + 16}" cy="${y - 14}" r="16" fill="${ACCENT}"/>`);
  parts.push(text('Herta Bot バージョン', pad + 52, y, 44, TEXT_MAIN, 'bold'));

  // ビルド（主役。短縮 SHA を大きく出す）
  y += 58;
  parts.push(text('ビルド', pad, y, 26, TEXT_SUB));
  y += 76;
  if (model.shortSha) {
    parts.push(text(model.shortSha, pad, y, 64, TEXT_MAIN, 'bold'));
  } else {
    parts.push(text('不明', pad, y, 64, TEXT_SUB, 'bold'));
    y += 44;
    parts.push(text('このビルドには記録されていません', pad, y, 25, TEXT_SUB));
  }

  // 区切り
  y += 36;
  parts.push(
    `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="${DIVIDER}" stroke-width="2"/>`,
  );

  // 詳細行
  const rows: { label: string; value: string }[] = [
    { label: 'コミット', value: model.commitSha ?? '—' },
    { label: '環境', value: model.environmentLabel },
    { label: '起動時刻', value: `${model.startedAtLabel} JST` },
    { label: '稼働時間', value: model.uptimeLabel },
    { label: 'Node.js', value: model.nodeVersion },
  ];
  for (const row of rows) {
    y += 56;
    parts.push(text(row.label, pad, y, 27, TEXT_SUB));
    parts.push(
      text(row.value, pad + 200, y, 28, TEXT_MAIN, row.label === 'コミット' ? '' : 'bold'),
    );
  }

  // フッター
  y += 58;
  parts.push(text('Herta · ivRooom', pad, y, 22, TEXT_SUB));

  const height = y + 48;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="36" fill="#101620"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="28" fill="none" stroke="${ACCENT}" stroke-width="2"/>
    <g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">
    ${parts.join('\n    ')}
    </g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
