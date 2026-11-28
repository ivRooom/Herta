import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { HoyolabEndgameEntry, HoyolabProgressSnapshot } from './game-accounts-ivrm.js';

/**
 * Star Rail progress image card (#1079): the Star Rail sibling of the
 * Genshin progress card (#1010), rendering the stored HoYoLAB progress
 * snapshot as a 1600x900 PNG in the same sharp style. Star Rail
 * snapshots carry no per-area exploration, so the layout follows the
 * approved mock (星穹列車風背景): a Trailblaze Level emblem where the
 * Genshin card has its donut, the four summary stats the snapshot
 * actually has, and the three endgame modes as side-by-side cards.
 * Endgame modes without an attempt this schedule (hasData=false, or no
 * entry at all) render as a grayed 未挑戦 card instead of being
 * dropped. The plugin falls back to the text embed when rendering
 * throws, so every failure here is safe.
 */

export const STARRAIL_PROGRESS_CARD_WIDTH = 1600;
export const STARRAIL_PROGRESS_CARD_HEIGHT = 900;
export const STARRAIL_PROGRESS_CARD_FILE_NAME = 'starrail-progress-card.png';

const BACKGROUND_PATH = fileURLToPath(
  new URL('../../assets/game-progress/starrail-astral-express.webp', import.meta.url),
);

const FONT_STACK = "'Noto Sans CJK JP','Noto Sans JP','Yu Gothic',sans-serif";
const FG = '#f5f5f7';
const MUTED = '#c9c9d4';
const SUBTLE = '#9298ad';
const GOLD = '#ffc94d';
const PURPLE = '#c39bff';
const TEAL = '#5ad8e6';
const NO_DATA_ACCENT = '#5a6274';
const SURFACE = 'rgba(13,16,32,0.80)';
const PANEL = 'rgba(13,16,32,0.55)';
const LINE = 'rgba(255,255,255,0.16)';

/** Memory of Chaos awards at most 36 stars (12 floors x 3). */
const MEMORY_OF_CHAOS_MAX_STARS = 36;

export interface StarRailProgressCardInput {
  snapshot: HoyolabProgressSnapshot;
  uid: string;
  /** Pre-formatted JST label (see formatJstDateTime in game-accounts-core). */
  fetchedAtLabel: string;
}

export interface StarRailEndgameCardModel {
  kind: 'memory_of_chaos' | 'pure_fiction' | 'apocalyptic_shadow';
  name: string;
  englishName: string;
  kanji: string;
  /** Accent color, already swapped for the gray no-data tone when hasData is false. */
  accent: string;
  label: string;
  /** Main metric text, or 未挑戦 when the mode has no attempt this schedule. */
  value: string;
  hasData: boolean;
  /** Memory of Chaos only: stars earned, when the snapshot reports them. */
  stars: number | null;
  /** Memory of Chaos only: stars / max, clamped to 0..1, for the progress bar. */
  starRatio: number | null;
}

export interface StarRailProgressCardModel {
  playerLine: string;
  fetchedAtLabel: string;
  /** Trailblaze Level for the emblem, or null when the snapshot has none. */
  level: number | null;
  /** Only the stats the snapshot actually carries; missing stats are omitted, never zero-filled. */
  tiles: { label: string; value: string }[];
  endgame: StarRailEndgameCardModel[];
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

function buildTiles(snapshot: HoyolabProgressSnapshot): StarRailProgressCardModel['tiles'] {
  const tiles: StarRailProgressCardModel['tiles'] = [];
  const activeDays = statNumber(snapshot, 'activeDays');
  if (activeDays !== null) tiles.push({ label: '活動日数', value: `${formatCount(activeDays)}日` });
  const achievements = statNumber(snapshot, 'achievements');
  if (achievements !== null) {
    tiles.push({ label: 'アチーブメント', value: formatCount(achievements) });
  }
  const characters = statNumber(snapshot, 'characters');
  if (characters !== null) {
    tiles.push({ label: '獲得キャラクター', value: `${formatCount(characters)}体` });
  }
  const chests = statNumber(snapshot, 'chests');
  if (chests !== null) tiles.push({ label: '宝箱', value: formatCount(chests) });
  return tiles;
}

const ENDGAME_DEFS: ReadonlyArray<{
  kind: StarRailEndgameCardModel['kind'];
  name: string;
  englishName: string;
  kanji: string;
  accent: string;
  label: string;
}> = [
  {
    kind: 'memory_of_chaos',
    name: '混沌の記憶',
    englishName: 'Memory of Chaos',
    kanji: '混',
    accent: PURPLE,
    label: '到達フロア',
  },
  {
    kind: 'pure_fiction',
    name: '虚構叙事',
    englishName: 'Pure Fiction',
    kanji: '虚',
    accent: GOLD,
    label: '最高スコア',
  },
  {
    kind: 'apocalyptic_shadow',
    name: '末日の幻影',
    englishName: 'Apocalyptic Shadow',
    kanji: '影',
    accent: TEAL,
    label: '最高スコア',
  },
];

function buildEndgameCard(
  def: (typeof ENDGAME_DEFS)[number],
  entry: HoyolabEndgameEntry | undefined,
): StarRailEndgameCardModel {
  const hasData = entry?.hasData === true;
  if (!hasData) {
    return {
      kind: def.kind,
      name: def.name,
      englishName: def.englishName,
      kanji: def.kanji,
      accent: NO_DATA_ACCENT,
      label: def.label,
      value: '未挑戦',
      hasData: false,
      stars: null,
      starRatio: null,
    };
  }
  if (def.kind === 'memory_of_chaos') {
    const stars = entry.totalStars;
    return {
      kind: def.kind,
      name: def.name,
      englishName: def.englishName,
      kanji: def.kanji,
      accent: def.accent,
      label: def.label,
      value: entry.maxFloor ?? '—',
      hasData: true,
      stars,
      starRatio:
        stars === null ? null : Math.min(1, Math.max(0, stars / MEMORY_OF_CHAOS_MAX_STARS)),
    };
  }
  return {
    kind: def.kind,
    name: def.name,
    englishName: def.englishName,
    kanji: def.kanji,
    accent: def.accent,
    label: def.label,
    value: entry.totalScore === null ? '—' : formatCount(entry.totalScore),
    hasData: true,
    stars: null,
    starRatio: null,
  };
}

export function buildStarRailProgressCardModel(
  input: StarRailProgressCardInput,
): StarRailProgressCardModel {
  const { snapshot } = input;
  const playerParts: string[] = [];
  if (snapshot.player.nickname) playerParts.push(truncateChars(snapshot.player.nickname, 24));
  if (snapshot.player.level !== null) playerParts.push(`開拓レベル ${snapshot.player.level}`);
  playerParts.push(`UID ${input.uid}`);

  return {
    playerLine: playerParts.join(' ・ '),
    fetchedAtLabel: input.fetchedAtLabel,
    level: snapshot.player.level,
    tiles: buildTiles(snapshot),
    endgame: ENDGAME_DEFS.map((def) =>
      buildEndgameCard(
        def,
        snapshot.endgame.find((entry) => entry.kind === def.kind),
      ),
    ),
  };
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

export function buildStarRailProgressCardSvg(
  model: StarRailProgressCardModel,
  backgroundDataUri: string | null,
): string {
  const W = STARRAIL_PROGRESS_CARD_WIDTH;
  const H = STARRAIL_PROGRESS_CARD_HEIGHT;
  let s = `<rect width="${W}" height="${H}" fill="#0d1020"/>`;
  if (backgroundDataUri) {
    s += `<image href="${backgroundDataUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  s += `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0c1e" stop-opacity="0.40"/><stop offset="0.45" stop-color="#0a0c1e" stop-opacity="0.62"/><stop offset="1" stop-color="#0a0c1e" stop-opacity="0.88"/></linearGradient><linearGradient id="lvlGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD}"/><stop offset="1" stop-color="${PURPLE}"/></linearGradient><linearGradient id="railGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.15"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="${PURPLE}" stop-opacity="0.15"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#shade)"/>`;
  s += `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="30" fill="none" stroke="#a8c8ff" stroke-width="2" opacity="0.7"/>`;

  // Header
  s += text(56, 78, '崩壊：スターレイルの戦績', 40, FG, 800);
  s += text(56, 112, model.playerLine, 17, MUTED);
  s += `<rect x="1212" y="44" width="332" height="42" rx="21" fill="rgba(255,201,77,0.13)"/>`;
  s += text(1378, 72, `取得 ${model.fetchedAtLabel}`, 15, GOLD, 700, 'middle');

  // Trailblaze Level emblem (where the Genshin card puts its donut)
  const cx = 148;
  const cy = 252;
  const r = 74;
  const circ = 2 * Math.PI * r;
  s += `<circle cx="${cx}" cy="${cy}" r="94" fill="${PANEL}"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="20"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#lvlGrad)" stroke-width="20" stroke-linecap="round" stroke-dasharray="${circ * 0.92} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>`;
  s += text(cx, cy - 26, '開拓レベル', 13, GOLD, 700, 'middle');
  s += text(cx, cy + 28, model.level === null ? '—' : `${model.level}`, 52, FG, 800, 'middle');
  s += text(cx, cy + 52, 'Trailblaze Level', 11, SUBTLE, 400, 'middle');
  for (const [dx, color] of [
    [cx - 26, PURPLE],
    [cx, GOLD],
    [cx + 26, PURPLE],
  ] as const) {
    s += `<rect x="${dx - 5}" y="360" width="10" height="10" fill="${color}" transform="rotate(45 ${dx} 365)"/>`;
  }

  // Summary tiles (2 rows x 2, only the stats the snapshot carries)
  model.tiles.forEach((tile, i) => {
    const x = 268 + (i % 2) * 658;
    const y = 140 + Math.floor(i / 2) * 112;
    s += `<rect x="${x}" y="${y}" width="634" height="96" rx="16" fill="${SURFACE}" stroke="${LINE}"/>`;
    s += text(x + 22, y + 34, tile.label, 14, SUBTLE);
    s += text(x + 22, y + 74, tile.value, 26, FG, 800);
  });

  // Endgame panel (three modes side by side)
  s += `<rect x="40" y="388" width="1520" height="352" rx="18" fill="${PANEL}"/>`;
  s += text(56, 416, 'エンドコンテンツ', 22, FG, 800);
  s += text(266, 416, '到達フロア ・ 獲得スター ・ 最高スコア', 14, SUBTLE);
  model.endgame.forEach((card, i) => {
    const x = 56 + i * 502;
    const y = 440;
    const w = 482;
    const h = 264;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${SURFACE}" stroke="${LINE}"/>`;
    s += text(x + w - 28, y + h - 24, card.kanji, 110, 'rgba(255,255,255,0.05)', 800, 'end');
    s += `<circle cx="${x + 38}" cy="${y + 40}" r="10" fill="${card.accent}"/>`;
    s += text(x + 58, y + 48, card.name, 20, card.hasData ? FG : MUTED, 800);
    s += text(x + 24, y + 108, card.label, 13, SUBTLE);
    s += text(x + 24, y + 160, card.value, 46, card.hasData ? FG : SUBTLE, 800);
    if (card.stars !== null) {
      s += text(x + w - 24, y + 160, `★ ${card.stars}`, 30, GOLD, 800, 'end');
    }
    if (card.starRatio !== null) {
      s += `<rect x="${x + 24}" y="${y + 182}" width="${w - 48}" height="8" rx="4" fill="rgba(255,255,255,0.10)"/>`;
      s += `<rect x="${x + 24}" y="${y + 182}" width="${(w - 48) * card.starRatio}" height="8" rx="4" fill="${GOLD}"/>`;
    }
    s += `<rect x="${x + 24}" y="${y + 216}" width="${w - 48}" height="1" fill="${LINE}"/>`;
    s += text(x + 24, y + 242, card.englishName, 12, SUBTLE);
  });

  // Astral Express rail decoration (bottom band)
  s += `<rect x="56" y="790" width="1488" height="3" fill="url(#railGrad)"/>`;
  [56, 428, 800, 1172, 1544].forEach((dx, i) => {
    if (i === 2) {
      s += `<circle cx="${dx}" cy="791" r="9" fill="${GOLD}"/>`;
    } else {
      s += `<circle cx="${dx}" cy="791" r="6" fill="#0d1020" stroke="${GOLD}" stroke-width="2"/>`;
    }
  });

  s += text(56, 852, 'game progress ・ Herta', 13, SUBTLE);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

async function loadBackgroundDataUri(): Promise<string | null> {
  try {
    const bytes = await readFile(BACKGROUND_PATH);
    // librsvg (sharp's SVG rasterizer) cannot rasterize WebP data URIs and
    // silently drops the <image>, leaving a flat card (#1036). Re-encode
    // the asset as JPEG, which librsvg does paint, before embedding it.
    const jpeg = await sharp(bytes).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    // A missing decorative asset must not prevent the card (fortune-card pattern);
    // the plugin still falls back to the text embed if the render itself fails.
    return null;
  }
}

export async function renderStarRailProgressCard(
  input: StarRailProgressCardInput,
): Promise<Buffer> {
  const model = buildStarRailProgressCardModel(input);
  const background = await loadBackgroundDataUri();
  const svg = buildStarRailProgressCardSvg(model, background);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
