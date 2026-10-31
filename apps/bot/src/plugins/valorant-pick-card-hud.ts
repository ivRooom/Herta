import type { ValorantPickCardInput } from './valorant-pick-card.js';

/**
 * Editorial key-art agent reveal (v3). All remote portraits are bounded PNG
 * buffers from the caller. Keep user-controlled content escaped, never add
 * foreignObject, scripts or user-derived URLs to this SVG.
 */
function safe(value: string, max = 28): string {
  const normalized = Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
    .slice(0, max)
    .join('');
  return (normalized || '---').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  fill = '#f5f0e8',
  weight = 700,
  max = 26,
): string {
  return (
    '<text x="' +
    x +
    '" y="' +
    y +
    '" font-size="' +
    size +
    '" font-weight="' +
    weight +
    '" fill="' +
    fill +
    '">' +
    safe(value, max) +
    '</text>'
  );
}

function portrait(
  image: Buffer | null | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  if (!image) return '';
  return (
    '<image href="data:image/png;base64,' +
    image.toString('base64') +
    '" x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    w +
    '" height="' +
    h +
    '" preserveAspectRatio="xMidYMid meet"/>'
  );
}

/**
 * The agent is the hero, not a grid of HUD widgets.
 * Solos give the illustration the entire right half of the frame; text is
 * contained in a dark, legible left silhouette. No user-controlled SVG URLs.
 */
function solo(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const entry = input.entries[0]!;
  const nameLength = Array.from(entry.agentName).length;
  const agentFont = Math.min(98, Math.floor(540 / Math.max(1, nameLength * 0.68)));
  const parts: string[] = [
    '<path d="M672 104 H1200 V594 H548 Z" fill="#1d2029"/>',
    '<path d="M1008 105 H1200 V594 H837 Z" fill="#ff4655" opacity=".21"/>',
    '<path d="M836 106 L1180 106 L978 592 L655 592Z" fill="none" stroke="#e95461" stroke-width="2" opacity=".23"/>',
    '<path d="M1173 128 V570 M1150 570 H1173" stroke="#f6ebe3" stroke-width="2" opacity=".42"/>',
  ];
  if (portraits[0]) {
    parts.push('<g clip-path="url(#solo-art)">', portrait(portraits[0], 555, 94, 702, 548), '</g>');
  } else {
    parts.push(
      '<circle cx="932" cy="349" r="193" fill="#111922" stroke="#843742" stroke-width="2"/>',
      '<circle cx="932" cy="349" r="158" fill="none" stroke="#b74250" stroke-width="1" opacity=".4"/>',
      '<path d="M932 175 L1078 348 L932 523 L787 348 Z" fill="#232632" stroke="#e95765" stroke-width="2"/>',
      '<path d="M932 222 L1038 348 L932 476 L826 348 Z" fill="#10141c"/>',
      text(entry.agentName.toUpperCase(), 766, 362, 36, '#f1d7d3', 850, 14),
    );
  }
  parts.push(
    '<rect x="0" y="96" width="735" height="498" fill="url(#reading)"/>',
    '<path d="M52 175 H127" stroke="#ff4655" stroke-width="4"/>',
    text('01 / HERO PICK', 54, 161, 16, '#ff7b85', 800),
    text('SELECTED AGENT', 54, 253, 15, '#bbb2af', 750),
    text(entry.agentName.toUpperCase(), 48, 351, agentFont, '#fcf4eb', 900, 20),
    text(entry.displayName, 54, 401, 27, '#e1d8d2', 700, 17),
    '<path d="M54 439 H525" stroke="#a73c49" stroke-width="2"/>',
    text('ROLE', 54, 480, 14, '#aeaaa9', 800),
    text(roles[0] ?? 'エージェント', 133, 480, 20, '#ff8590', 750, 13),
    text('PLAYER', 54, 515, 14, '#aeaaa9', 800),
    text(entry.playerLabel ?? 'PLAYER 01', 54, 565, 30, '#faf0e8', 750, 17),
    '<path d="M54 558 H122" stroke="#ff4655" stroke-width="4"/>',
  );
  return parts.join('');
}

/**
 * Continuous agent lineup; the portraits dominate each column, while the
 * dark bottom of each column protects Japanese player and role labels.
 */
function squad(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const gap = count === 2 ? 18 : 12;
  const width = (1096 - gap * (count - 1)) / count;
  const start = 52;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = start + i * (width + gap);
    const entry = input.entries[i]!;
    const art = portraits[i];
    const nameFont = count === 5 ? 25 : count === 4 ? 30 : 38;
    const playerFont = count === 5 ? 17 : count === 4 ? 19 : 21;
    const nameLimit = Math.max(1, Math.floor((width - 26) / nameFont));
    const playerLimit = Math.max(1, Math.floor((width - 26) / playerFont));
    const fallbackFont = count >= 4 ? 21 : 28;
    const fallbackLimit = Math.max(1, Math.floor((width - 40) / fallbackFont));
    const artWidth = Math.max(width + 40, Math.min(590, width * 1.55));
    const artX = x + (width - artWidth) / 2;
    parts.push(
      '<g>',
      '<rect x="' + x + '" y="108" width="' + width + '" height="475" fill="#1b2029"/>',
      '<path d="M' +
        (x + width * 0.54) +
        ' 108 H' +
        (x + width) +
        ' V458 H' +
        x +
        ' Z" fill="#a8374b" opacity=".21"/>',
      '<path d="M' +
        x +
        ' 108 H' +
        (x + Math.min(96, width * 0.42)) +
        '" stroke="#ff4655" stroke-width="5"/>',
      '<clipPath id="lineup-art-' +
        i +
        '"><rect x="' +
        (x + 2) +
        '" y="108" width="' +
        (width - 4) +
        '" height="358"/></clipPath>',
    );
    if (art) {
      parts.push(
        '<g clip-path="url(#lineup-art-' + i + ')">',
        portrait(art, artX, 127, artWidth, 354),
        '</g>',
      );
    } else {
      parts.push(
        '<path d="M' +
          (x + width / 2) +
          ' 194 l' +
          width * 0.33 +
          ' 134 -' +
          width * 0.33 +
          ' 134 -' +
          width * 0.33 +
          ' -134 Z" fill="#242a34" stroke="#b93f50" stroke-width="2"/>',
        '<path d="M' +
          (x + 20) +
          ' 361 L' +
          (x + width - 20) +
          ' 204" stroke="#ff4655" stroke-opacity=".22" stroke-width="3"/>',
        text(
          entry.agentName.toUpperCase(),
          x + 20,
          337,
          fallbackFont,
          '#e9b3b3',
          850,
          fallbackLimit,
        ),
      );
    }
    parts.push(
      '<rect x="' + x + '" y="393" width="' + width + '" height="190" fill="url(#card-foot)"/>',
      '<path d="M' +
        (x + 12) +
        ' 438 H' +
        (x + width - 12) +
        '" stroke="#9b3847" stroke-width="1.5"/>',
      text(String(i + 1).padStart(2, '0'), x + 14, 148, 26, '#fff5e9', 900, 2),
      text(entry.displayName, x + 13, 485, nameFont, '#fff5e9', 850, nameLimit),
      text(roles[i] ?? 'エージェント', x + 13, 520, 15, '#ff8894', 750, 12),
      '<path d="M' +
        (x + 13) +
        ' 532 H' +
        (x + width - 13) +
        '" stroke="#4c444c" stroke-width="1"/>',
      text(
        entry.playerLabel ?? 'PLAYER ' + (i + 1),
        x + 13,
        558,
        playerFont,
        '#f1e3dc',
        700,
        playerLimit,
      ),
      '</g>',
    );
  }
  return parts.join('');
}

export function renderValorantHudSvg(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const mode = input.mode === 'TACTICAL' ? '実戦向け構成' : '完全ランダム';
  const footer = input.planLabel ? '構成：' + input.planLabel : 'HERTA / AGENT SELECTION';
  const parts: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">',
    '<defs>',
    '<linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07090d"/><stop offset=".6" stop-color="#151923"/><stop offset="1" stop-color="#080b11"/></linearGradient>',
    '<linearGradient id="reading" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#080b10"/><stop offset=".75" stop-color="#080b10" stop-opacity=".99"/><stop offset="1" stop-color="#080b10" stop-opacity="0"/></linearGradient>',
    '<linearGradient id="card-foot" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#0c1119" stop-opacity="0"/><stop offset=".23" stop-color="#10141b" stop-opacity=".98"/><stop offset="1" stop-color="#090c12"/></linearGradient>',
    '<clipPath id="frame"><rect x="0" y="0" width="1200" height="680"/></clipPath>',
    '<clipPath id="solo-art"><rect x="568" y="100" width="632" height="494"/></clipPath>',
    '</defs>',
    '<g clip-path="url(#frame)" font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, Arial, sans-serif">',
    '<rect width="1200" height="680" fill="url(#scene)"/>',
    '<path d="M880 0 H1200 V680 H1125Z" fill="#ff4655" opacity=".055"/>',
    '<path d="M0 0 H8 V680 H0Z" fill="#ff4655"/>',
    '<path d="M48 16 H1152" stroke="#6a5556" stroke-width="1" opacity=".65"/>',
  ];
  // All portraits are beneath typography and the metadata strip.
  parts.push(count === 1 ? solo(input, portraits, roles) : squad(input, portraits, roles));
  parts.push(
    '<rect x="0" y="0" width="1200" height="98" fill="#080b10" opacity=".94"/>',
    text('HERTA / VALORANT', 52, 32, 14, '#ff7b86', 850),
    text('AGENT REVEAL', 52, 81, 39, '#fff4e9', 900),
    text(count === 1 ? 'SOLO // HERO PICK' : 'SQUAD // LINEUP', 841, 53, 16, '#c4bbb6', 750, 24),
    text('抽選完了', 1049, 85, 18, '#ff8992', 800, 8),
    '<path d="M52 97 H1148" stroke="#60454b" stroke-width="1.5"/>',
    '<rect x="0" y="592" width="1200" height="88" fill="#090d13" opacity=".98"/>',
    '<path d="M52 593 H1148" stroke="#ff4655" stroke-width="2"/>',
    text('MODE', 52, 621, 12, '#9f9b9a', 700),
    text(mode, 52, 650, 19, '#f5eae2', 800, 12),
    text('MAP', 320, 621, 12, '#9f9b9a', 700),
    text(input.mapName, 320, 650, 19, '#f5eae2', 800, 16),
    text('PARTICIPANTS', 610, 621, 12, '#9f9b9a', 700),
    text(count + ' / 5', 610, 650, 20, '#f5eae2', 800),
    text('STATUS', 820, 621, 12, '#9f9b9a', 700),
    text('PICK COMPLETE', 820, 650, 17, '#ff8790', 850),
    text(footer, 52, 673, 12, '#aaa4a2', 500, 40),
    '</g></svg>',
  );
  return parts.join('');
}
