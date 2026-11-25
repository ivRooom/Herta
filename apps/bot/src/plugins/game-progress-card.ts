import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { formatPercent } from './game-accounts-core.js';
import type { HoyolabProgressSnapshot } from './game-accounts-ivrm.js';

/**
 * Genshin progress image card (#1010): renders the stored HoYoLAB
 * progress snapshot as a 1600x900 PNG in the same sharp style as the
 * other bot cards, replacing the text embed for `/game progress`
 * (genshin only). The layout follows the approved mock (ナド・クライ風
 * 「霜月の祠」背景): overall-exploration donut, six summary tiles,
 * exploration bars sorted high to low, 0% areas folded into chips and
 * a stacked chest bar. The plugin falls back to the text embed when
 * rendering throws, so every failure here is safe.
 */

export const GENSHIN_PROGRESS_CARD_WIDTH = 1600;
export const GENSHIN_PROGRESS_CARD_HEIGHT = 900;
export const GENSHIN_PROGRESS_CARD_FILE_NAME = 'genshin-progress-card.png';

const BACKGROUND_PATH = fileURLToPath(
  new URL('../../assets/game-progress/nodkrai-frostmoon-shrine.webp', import.meta.url),
);

const FONT_STACK = "'Noto Sans CJK JP','Noto Sans JP','Yu Gothic',sans-serif";
const FG = '#f5f5f7';
const MUTED = '#c7c7cc';
const SUBTLE = '#8b93a7';
const TEAL = '#5ad8e6';
const GREEN = '#57f287';
const GOLD = '#ffc94d';
const PURPLE = '#c39bff';
const PINK = '#ff8fb3';
const SURFACE = 'rgba(13,18,30,0.80)';
const LINE = 'rgba(255,255,255,0.16)';

/** Bars fit two columns of 8 + 7 rows; lower positives beyond that are counted, not drawn. */
const MAX_AREA_BARS = 15;

export interface GenshinProgressCardInput {
  snapshot: HoyolabProgressSnapshot;
  uid: string;
  /** Pre-formatted JST label (see formatJstDateTime in game-accounts-core). */
  fetchedAtLabel: string;
}

export interface GenshinProgressAreaBar {
  name: string;
  percent: number;
}

export interface GenshinProgressChestSegment {
  label: string;
  shortLabel: string;
  count: number;
  color: string;
}

export interface GenshinProgressCardModel {
  playerLine: string;
  fetchedAtLabel: string;
  /** Mean of the measured areas, or null when nothing was measured. */
  overallPercent: number | null;
  measuredAreaCount: number;
  bars: GenshinProgressAreaBar[];
  omittedBarCount: number;
  untouched: string[];
  untouchedLabel: string;
  tiles: { label: string; value: string }[];
  chestTotal: number | null;
  chestSegments: GenshinProgressChestSegment[];
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

function truncateChars(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
}

function statNumber(snapshot: HoyolabProgressSnapshot, key: string): number | null {
  const value = snapshot.stats[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatCount(value: number): string {
  return value.toLocaleString('ja-JP');
}

/** One decimal at most, dropping a trailing .0 (same rule as the text embed). */
function formatOverallPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

const CHEST_DEFS: ReadonlyArray<{
  label: string;
  shortLabel: string;
  key: string;
  color: string;
}> = [
  { label: '普通の宝箱', shortLabel: '普通', key: 'commonChests', color: '#8b93a7' },
  { label: '精巧な宝箱', shortLabel: '精巧', key: 'exquisiteChests', color: TEAL },
  { label: '貴重な宝箱', shortLabel: '貴重', key: 'preciousChests', color: GREEN },
  { label: '豪華な宝箱', shortLabel: '豪華', key: 'luxuriousChests', color: GOLD },
  { label: '珍奇な宝箱', shortLabel: '珍奇', key: 'magicChests', color: PINK },
];

function buildTiles(snapshot: HoyolabProgressSnapshot): GenshinProgressCardModel['tiles'] {
  const count = (key: string, suffix = ''): string => {
    const value = statNumber(snapshot, key);
    return value === null ? '—' : `${formatCount(value)}${suffix}`;
  };
  const abyss = snapshot.endgame.find((entry) => entry.kind === 'spiral_abyss');
  const abyssValue =
    abyss && abyss.hasData
      ? `到達 ${abyss.maxFloor ?? '—'} ・ ★${abyss.totalStars ?? 0}`
      : '記録なし';
  return [
    { label: '活動日数', value: count('activeDays', '日') },
    { label: 'アチーブメント', value: count('achievements') },
    { label: '所持キャラクター', value: count('characters', '体') },
    { label: 'ワープポイント', value: count('waypoints') },
    { label: '秘境', value: count('domains') },
    { label: '深境螺旋', value: abyssValue },
  ];
}

export function buildGenshinProgressCardModel(
  input: GenshinProgressCardInput,
): GenshinProgressCardModel {
  const { snapshot } = input;
  const measured = snapshot.explorations
    .map((area, index) => ({ area, index }))
    .filter(
      (entry): entry is { area: typeof entry.area; index: number } =>
        entry.area.percent !== null && Number.isFinite(entry.area.percent),
    );
  const overallPercent =
    measured.length > 0
      ? measured.reduce((sum, entry) => sum + (entry.area.percent ?? 0), 0) / measured.length
      : null;
  const sortedPositives = measured
    .filter((entry) => (entry.area.percent ?? 0) > 0)
    .sort((a, b) => (b.area.percent ?? 0) - (a.area.percent ?? 0) || a.index - b.index);
  const bars = sortedPositives.slice(0, MAX_AREA_BARS).map((entry) => ({
    name: entry.area.name ?? '名称不明のエリア',
    percent: entry.area.percent ?? 0,
  }));
  const zeroNames = measured
    .filter((entry) => entry.area.percent === 0)
    .map((entry) => entry.area.name ?? '名称不明のエリア');
  const unmeasuredNames = snapshot.explorations
    .filter((area) => area.percent === null)
    .map((area) => area.name ?? '名称不明のエリア');
  const untouched = [...zeroNames, ...unmeasuredNames];

  const chestSegments = CHEST_DEFS.flatMap((def) => {
    const count = statNumber(snapshot, def.key);
    return count === null
      ? []
      : [{ label: def.label, shortLabel: def.shortLabel, count, color: def.color }];
  });
  const chestTotal =
    statNumber(snapshot, 'totalChests') ??
    (chestSegments.length > 0
      ? chestSegments.reduce((sum, segment) => sum + segment.count, 0)
      : null);

  const playerParts: string[] = [];
  if (snapshot.player.nickname) playerParts.push(truncateChars(snapshot.player.nickname, 24));
  if (snapshot.player.level !== null) playerParts.push(`冒険ランク ${snapshot.player.level}`);
  playerParts.push(`UID ${input.uid}`);

  return {
    playerLine: playerParts.join(' ・ '),
    fetchedAtLabel: input.fetchedAtLabel,
    overallPercent,
    measuredAreaCount: measured.length,
    bars,
    omittedBarCount: sortedPositives.length - bars.length,
    untouched,
    untouchedLabel: unmeasuredNames.length > 0 ? '未着手・未計測' : '未着手（0%）',
    tiles: buildTiles(snapshot),
    chestTotal,
    chestSegments,
  };
}

function barColor(percent: number): string {
  if (percent >= 99) return GOLD;
  if (percent >= 35) return GREEN;
  if (percent >= 20) return TEAL;
  if (percent >= 10) return '#7aa8ff';
  return PURPLE;
}

function text(
  x: number,
  y: number,
  value: string,
  size = 14,
  fill = FG,
  weight = 400,
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function bar(x: number, y: number, width: number, percent: number): string {
  const color = barColor(percent);
  const filled = percent > 0 ? Math.max(10, (width * Math.min(100, percent)) / 100) : 0;
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="10" rx="5" fill="rgba(255,255,255,0.10)"/>` +
    (filled > 0
      ? `<rect x="${x}" y="${y}" width="${filled}" height="10" rx="5" fill="${color}"/>`
      : '')
  );
}

/** Estimated chip width at 14px: padding plus ~21px per character (matches the mock). */
function chipWidth(name: string): number {
  return 28 + Array.from(name).length * 21;
}

export function buildGenshinProgressCardSvg(
  model: GenshinProgressCardModel,
  backgroundDataUri: string | null,
): string {
  const W = GENSHIN_PROGRESS_CARD_WIDTH;
  const H = GENSHIN_PROGRESS_CARD_HEIGHT;
  let s = `<rect width="${W}" height="${H}" fill="#101620"/>`;
  if (backgroundDataUri) {
    s += `<image href="${backgroundDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  s += `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b101c" stop-opacity="0.42"/><stop offset="0.45" stop-color="#0b101c" stop-opacity="0.62"/><stop offset="1" stop-color="#0b101c" stop-opacity="0.86"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#shade)"/>`;
  s += `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="30" fill="none" stroke="#a8c8ff" stroke-width="2" opacity="0.7"/>`;

  // Header
  s += text(56, 78, '原神の探索度', 40, FG, 800);
  s += text(56, 112, model.playerLine, 17, MUTED);
  s += `<rect x="1212" y="44" width="332" height="42" rx="21" fill="rgba(90,216,230,0.13)"/>`;
  s += text(1378, 72, `取得 ${model.fetchedAtLabel}`, 15, TEAL, 700, 'middle');

  // Overall donut
  const cx = 148;
  const cy = 252;
  const r = 74;
  const circ = 2 * Math.PI * r;
  s += `<circle cx="${cx}" cy="${cy}" r="94" fill="rgba(13,18,30,0.55)"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="20"/>`;
  if (model.overallPercent !== null) {
    const ratio = Math.min(1, Math.max(0, model.overallPercent / 100));
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TEAL}" stroke-width="20" stroke-linecap="round" stroke-dasharray="${circ * ratio} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>`;
    s += text(cx, cy + 4, `${formatOverallPercent(model.overallPercent)}%`, 30, FG, 800, 'middle');
  } else {
    s += text(cx, cy + 4, '—', 30, FG, 800, 'middle');
  }
  s += text(cx, cy + 32, '総合探索度', 13, SUBTLE, 400, 'middle');
  s += text(
    cx,
    366,
    model.overallPercent !== null ? `全${model.measuredAreaCount}エリア平均` : '計測データなし',
    13,
    SUBTLE,
    400,
    'middle',
  );

  // Summary tiles (2 rows x 3)
  model.tiles.forEach((tile, i) => {
    const x = 268 + (i % 3) * 428;
    const y = 140 + Math.floor(i / 3) * 112;
    s += `<rect x="${x}" y="${y}" width="404" height="96" rx="16" fill="${SURFACE}" stroke="${LINE}"/>`;
    s += text(x + 22, y + 34, tile.label, 14, SUBTLE);
    s += text(x + 22, y + 74, tile.value, 26, FG, 800);
  });

  // Exploration bars (two columns, high to low)
  s += `<rect x="40" y="388" width="1520" height="352" rx="18" fill="rgba(13,18,30,0.55)"/>`;
  s += text(56, 416, 'エリア別探索度', 22, FG, 800);
  s += text(
    266,
    416,
    model.omittedBarCount > 0
      ? `高い順 ・ ほか ${model.omittedBarCount} エリアは省略`
      : '高い順 ・ 0%は下段にまとめて表示',
    14,
    SUBTLE,
  );
  const colW = 720;
  const rowH = 38;
  model.bars.forEach((area, i) => {
    const col = i < 8 ? 0 : 1;
    const idx = col === 0 ? i : i - 8;
    const x = 56 + col * (colW + 32);
    const y = 434 + idx * rowH;
    s += text(x, y + 16, truncateChars(area.name, 20), 16, MUTED, area.percent >= 99 ? 800 : 400);
    s += text(
      x + colW,
      y + 16,
      `${formatPercent(area.percent)}%`,
      16,
      area.percent >= 99 ? GOLD : FG,
      800,
      'end',
    );
    s += bar(x, y + 24, colW, area.percent);
  });
  if (model.bars.length === 0) {
    s += text(56, 470, '計測済みのエリアはまだありません', 16, MUTED);
  }

  // Untouched chips (left half of the bottom row)
  if (model.untouched.length > 0) {
    s += text(56, 788, model.untouchedLabel, 15, SUBTLE, 700);
    const labelWidth = Array.from(model.untouchedLabel).reduce(
      (width, char) => width + (char.charCodeAt(0) > 255 ? 16 : 9),
      0,
    );
    let chipX = 56 + labelWidth + 20;
    const chipLimit = 792;
    let shown = 0;
    for (const name of model.untouched) {
      const w = chipWidth(name);
      const remaining = model.untouched.length - shown;
      const reserve = remaining > 1 ? chipWidth(`+${remaining - 1}`) + 12 : 0;
      if (chipX + w > chipLimit - reserve && shown > 0) break;
      s += `<rect x="${chipX}" y="766" width="${w}" height="34" rx="17" fill="rgba(13,18,30,0.80)" stroke="${LINE}"/>`;
      s += text(chipX + w / 2, 789, name, 14, MUTED, 400, 'middle');
      chipX += w + 12;
      shown += 1;
    }
    const hidden = model.untouched.length - shown;
    if (hidden > 0) {
      const label = `+${hidden}`;
      const w = chipWidth(label);
      s += `<rect x="${chipX}" y="766" width="${w}" height="34" rx="17" fill="rgba(13,18,30,0.80)" stroke="${LINE}"/>`;
      s += text(chipX + w / 2, 789, label, 14, MUTED, 400, 'middle');
    }
  }

  // Chest stacked bar (right half of the bottom row)
  const chX = 808;
  const chW = 720;
  if (model.chestTotal !== null && model.chestTotal > 0 && model.chestSegments.length > 0) {
    s += text(chX, 764, `宝箱 合計 ${formatCount(model.chestTotal)}`, 15, FG, 800);
    let segX = chX;
    for (const segment of model.chestSegments) {
      const w = (chW * segment.count) / model.chestTotal;
      if (w > 0) {
        s += `<rect x="${segX}" y="776" width="${Math.max(w - 3, 4)}" height="18" rx="6" fill="${segment.color}"/>`;
      }
      segX += w;
    }
    let legX = chX;
    for (const segment of model.chestSegments) {
      s += `<circle cx="${legX + 7}" cy="822" r="7" fill="${segment.color}"/>`;
      s += text(legX + 20, 828, `${segment.shortLabel} ${formatCount(segment.count)}`, 14, MUTED);
      legX += 144;
    }
  } else {
    s += text(chX, 764, '宝箱 データなし', 15, SUBTLE, 700);
  }

  s += text(56, 852, 'game progress ・ Herta', 13, SUBTLE);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

async function loadBackgroundDataUri(): Promise<string | null> {
  try {
    const bytes = await readFile(BACKGROUND_PATH);
    return `data:image/webp;base64,${bytes.toString('base64')}`;
  } catch {
    // A missing decorative asset must not prevent the card (fortune-card pattern);
    // the plugin still falls back to the text embed if the render itself fails.
    return null;
  }
}

export async function renderGenshinProgressCard(input: GenshinProgressCardInput): Promise<Buffer> {
  const model = buildGenshinProgressCardModel(input);
  const background = await loadBackgroundDataUri();
  const svg = buildGenshinProgressCardSvg(model, background);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
