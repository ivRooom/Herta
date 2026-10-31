import type { ValorantPickCardInput } from './valorant-pick-card.js';

/**
 * Neon Poster Reveal (v5). All remote portraits are bounded PNG
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

const PINK = '#ff659f';
const VIOLET = '#b568ff';
const CYAN = '#69d9ff';
const ACCENTS = [CYAN, PINK, '#8caeff', VIOLET, '#ffd377'] as const;

function solo(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const entry = input.entries[0]!;
  const fontSize = Math.min(
    80,
    Math.floor(460 / Math.max(1, Array.from(entry.agentName).length * 0.66)),
  );
  const parts: string[] = [
    '<path d="M562 176 H1194 V576 H615Z" fill="#17143a" stroke="#a767ff" stroke-width="1.5"/>',
    '<path d="M859 178 H1194 V575 H700Z" fill="#b53296" opacity=".19"/>',
    '<circle cx="963" cy="377" r="288" fill="url(#halo)" opacity=".9"/>',
    '<path d="M1132 181 L1194 181 V331 L1096 331Z" fill="#ff488c" opacity=".35"/>',
    '<path d="M679 185 L1117 185 M1147 193 L1026 559" stroke="#ae83fc" stroke-width="2" opacity=".46"/>',
  ];
  if (portraits[0]) {
    parts.push(
      '<g clip-path="url(#solo-art)">',
      portrait(portraits[0], 575, 158, 655, 447),
      '</g>',
    );
  } else {
    parts.push(
      '<circle cx="936" cy="368" r="174" fill="#2b2058" stroke="#a36cfa" stroke-width="2"/>',
      '<path d="M936 217 L1087 367 L936 515 L784 367Z" fill="#0f1028" stroke="#ff5aaf" stroke-width="2"/>',
      text(entry.agentName.toUpperCase(), 794, 381, 32, '#fce1ff', 900, 13),
    );
  }
  parts.push(
    '<rect x="38" y="192" width="540" height="370" rx="16" fill="url(#reading)" stroke="#9c70dc" stroke-width="1.5"/>',
    '<path d="M56 210 H151" stroke="url(#neon)" stroke-width="4"/>',
    text('01 // HERO PICK', 57, 243, 17, '#dcb5ff', 800),
    text('SELECTED AGENT', 57, 286, 13, '#c5b9e6', 750),
    text(entry.agentName.toUpperCase(), 52, 375, fontSize, '#fff5ff', 900, 18),
    text(entry.displayName, 57, 414, 25, '#ffabd9', 750, 18),
    '<path d="M57 437 H535" stroke="#b96bec" opacity=".8"/>',
    '<rect x="56" y="447" width="476" height="65" rx="11" fill="#10132e" stroke="#755ac2" stroke-width="1"/>',
    text('PLAYER', 71, 467, 11, '#bfb5de', 700),
    text(entry.playerLabel ?? 'PLAYER 01', 71, 496, 24, '#f9f2ff', 750, 17),
    text('ROLE', 59, 544, 12, '#bfb5de', 700),
    text(roles[0] ?? 'エージェント', 134, 544, 18, '#ff8ac9', 750, 13),
  );
  return parts.join('');
}

/**
 * Left: actual player-to-agent assignments, no invented avatars.
 * Right: angled portrait shards. Draw the full image inside each fixed
 * polygon clip so even extreme portrait aspect ratios cannot cover text.
 */
function squad(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const parts: string[] = [];
  const rowHeight = count === 5 ? 65 : count === 4 ? 78 : count === 3 ? 97 : 126;
  const rowGap = count === 5 ? 8 : 10;
  const stageX = 588;
  const stageWidth = 580;
  const width = stageWidth / count;

  parts.push(
    '<path d="M580 176 H1171 L1126 577 H601Z" fill="#13142f" stroke="#7956c9" stroke-width="1.5"/>',
    '<path d="M793 177 H1168 V574 H1009Z" fill="#ff428c" opacity=".07"/>',
    '<path d="M1135 177 L1014 576 M647 176 L783 576" stroke="#b96dff" stroke-width="2" opacity=".26"/>',
  );

  for (let i = 0; i < count; i++) {
    const entry = input.entries[i]!;
    const color = ACCENTS[i]!;
    const y = 191 + i * (rowHeight + rowGap);
    const mid = y + rowHeight / 2;
    const x = stageX + i * width;
    const top = 183 + (i % 2) * 17;
    const bottom = 570 - ((i + 1) % 2) * 14;
    const borderPath =
      'M' +
      (x + 18) +
      ' ' +
      top +
      ' L' +
      (x + width - 2) +
      ' ' +
      (top - 10) +
      ' L' +
      (x + width - 18) +
      ' ' +
      bottom +
      ' L' +
      x +
      ' ' +
      (bottom + 9) +
      'Z';
    parts.push(
      '<g>',
      '<rect x="39" y="' +
        y +
        '" width="515" height="' +
        rowHeight +
        '" rx="12" fill="url(#row)" stroke="' +
        color +
        '" stroke-width="1.5"/>',
      '<path d="M42 ' +
        (y + 11) +
        ' V' +
        (y + rowHeight - 11) +
        '" stroke="' +
        color +
        '" stroke-width="3.5"/>',
      text(String(i + 1).padStart(2, '0'), 56, mid + 7, 21, '#d6a1ff', 850, 2),
      text('PLAYER', 110, mid - 13, 10, '#a9a9d2', 750),
      text(entry.playerLabel ?? 'PLAYER ' + (i + 1), 109, mid + 11, 16, '#faf3ff', 750, 10),
      '<path d="M286 ' +
        (mid - 3) +
        ' h28 m-9 -9 l9 9 -9 9" fill="none" stroke="' +
        color +
        '" stroke-width="2.2"/>',
      '<path d="M332 ' +
        (y + 12) +
        ' V' +
        (y + rowHeight - 12) +
        '" stroke="#67518d" stroke-width="1"/>',
      text(entry.displayName, 350, mid + 2, 20, '#fff8ff', 850, 9),
      text(roles[i] ?? 'エージェント', 350, mid + 22, 12, color, 700, 13),
      '<clipPath id="poster-art-' + i + '"><path d="' + borderPath + '"/></clipPath>',
      '<path d="' +
        borderPath +
        '" fill="#26204d" stroke="' +
        color +
        '" stroke-width="3" stroke-opacity=".9"/>',
      '<path d="M' +
        (x + 9) +
        ' ' +
        (top + 75) +
        ' L' +
        (x + width - 8) +
        ' ' +
        (top + 20) +
        ' V' +
        (bottom - 70) +
        'Z" fill="' +
        color +
        '" opacity=".19"/>',
    );
    if (portraits[i]) {
      const portraitWidth = Math.max(342, width * 1.55);
      const portraitX = x + (width - portraitWidth) / 2;
      parts.push(
        '<g clip-path="url(#poster-art-' + i + ')">',
        portrait(portraits[i], portraitX, 178, portraitWidth, 399),
        '</g>',
      );
    } else {
      parts.push(
        '<g clip-path="url(#poster-art-' + i + ')">',
        '<circle cx="' +
          (x + width / 2) +
          '" cy="359" r="' +
          Math.max(64, width * 0.4) +
          '" fill="url(#halo)" opacity=".8"/>',
        '<path d="M' +
          (x + width / 2) +
          ' 241 l' +
          Math.min(95, width * 0.32) +
          ' 110 -' +
          Math.min(95, width * 0.32) +
          ' 110 -' +
          Math.min(95, width * 0.32) +
          ' -110Z" fill="#0d1129" stroke="' +
          color +
          '" stroke-width="2"/>',
        '</g>',
      );
    }
    parts.push(
      '<path d="' +
        borderPath +
        '" fill="none" stroke="' +
        color +
        '" stroke-width="2" stroke-opacity=".7"/>',
      '<rect x="' +
        (x + 5) +
        '" y="506" width="' +
        Math.max(65, width - 21) +
        '" height="42" rx="8" fill="#090d25" opacity=".9"/>',
      text(
        entry.agentName.toUpperCase(),
        x + 12,
        534,
        count === 5 ? 14 : 17,
        '#fff4ff',
        850,
        count === 5 ? 9 : 16,
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
  const footer = input.planLabel ? '構成：' + input.planLabel : 'HERTA. / DISCORD BOT FOR GAMERS';
  const parts: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">',
    '<defs>',
    '<linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#06091b"/><stop offset=".48" stop-color="#131035"/><stop offset="1" stop-color="#090d22"/></linearGradient>',
    '<linearGradient id="row" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#191436"/><stop offset=".72" stop-color="#11142f"/><stop offset="1" stop-color="#21163a"/></linearGradient>',
    '<linearGradient id="reading" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#080d24" stop-opacity=".98"/><stop offset=".87" stop-color="#15102b" stop-opacity=".93"/><stop offset="1" stop-color="#1e1739" stop-opacity=".65"/></linearGradient>',
    '<linearGradient id="neon" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ff659f"/><stop offset=".5" stop-color="#b568ff"/><stop offset="1" stop-color="#69d9ff"/></linearGradient>',
    '<radialGradient id="halo"><stop stop-color="#ac56ff" stop-opacity=".75"/><stop offset=".5" stop-color="#df2c9d" stop-opacity=".25"/><stop offset="1" stop-color="#5c2ca0" stop-opacity="0"/></radialGradient>',
    '<filter id="glow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="6"/></filter>',
    '<clipPath id="frame"><rect x="0" y="0" width="1200" height="680" rx="9"/></clipPath>',
    '<clipPath id="solo-art"><path d="M618 183 H1188 V573 H573Z"/></clipPath>',
    '</defs>',
    '<g clip-path="url(#frame)" font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, Arial, sans-serif">',
    '<rect width="1200" height="680" fill="url(#scene)"/>',
    '<circle cx="990" cy="307" r="350" fill="url(#halo)" opacity=".65"/>',
    '<circle cx="139" cy="637" r="330" fill="url(#halo)" opacity=".34"/>',
    '<path d="M918 0 H1090 L923 196 H745Z" fill="#8f50dc" opacity=".1"/>',
    '<path d="M1058 0 H1200 V204 L1105 150Z" fill="#ff4288" opacity=".27"/>',
    '<path d="M0 491 L150 680 H0Z" fill="#db3fb9" opacity=".17"/>',
    '<path d="M7 0 L235 228 M270 0 L483 209 M784 0 L624 161 M1112 494 L1200 610" stroke="#ac67f9" stroke-width="2" stroke-opacity=".19"/>',
    '<path d="M0 10 H207 M1000 10 H1200 M0 670 H160 M998 670 H1200" stroke="url(#neon)" stroke-width="2" opacity=".75"/>',
    '<path d="M0 0 H7 V680 H0Z" fill="url(#neon)"/>',
    '<path d="M26 158 H1177" stroke="url(#neon)" stroke-width="2" opacity=".8"/>',
  ];
  parts.push(count === 1 ? solo(input, portraits, roles) : squad(input, portraits, roles));
  parts.push(
    text('Herta. / AGENT REVEAL', 45, 32, 17, '#c8b5ef', 800),
    text('VALORANT', 42, 90, 56, '#fcf4ff', 900, 12),
    text('エージェント抽選', 385, 85, 34, '#ff93cc', 850, 12),
    text(
      count === 1 ? 'SOLO  //  HERO PICK' : 'SQUAD  //  LINEUP',
      948,
      39,
      14,
      '#d6c8fb',
      750,
      24,
    ),
    '<rect x="43" y="111" width="202" height="43" rx="10" fill="#171330" stroke="#8c65db" stroke-width="1.3"/>',
    '<rect x="254" y="111" width="205" height="43" rx="10" fill="#171330" stroke="#8c65db" stroke-width="1.3"/>',
    '<rect x="469" y="111" width="155" height="43" rx="10" fill="#171330" stroke="#8c65db" stroke-width="1.3"/>',
    text('MODE', 54, 127, 10, '#a8a2cf', 650),
    text(mode, 55, 146, 17, '#fff6ff', 750, 11),
    text('MAP', 266, 127, 10, '#a8a2cf', 650),
    text(input.mapName, 266, 146, 17, '#fff6ff', 750, 11),
    text('PARTICIPANTS', 481, 127, 10, '#a8a2cf', 650),
    text(count + ' / 5', 483, 148, 19, '#fcf2ff', 850),
    '<rect x="40" y="584" width="482" height="62" rx="14" fill="#36113d" stroke="#ff5aab" stroke-width="2"/>',
    '<rect x="40" y="584" width="482" height="62" rx="14" fill="none" stroke="#ff65b6" stroke-width="5" opacity=".26" filter="url(#glow)"/>',
    '<circle cx="73" cy="615" r="18" fill="#ff70bb"/>',
    '<path d="M64 614 l6 7 14 -16" stroke="#301439" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    text('抽選完了', 103, 626, 28, '#fff5ff', 900),
    text('PICK COMPLETE', 317, 622, 13, '#e9c3ff', 850),
    text(footer, 542, 638, 16, '#d9bdf8', 600, 34),
    text('DISCORD BOT FOR GAMERS', 911, 667, 10, '#ae9bd9', 650, 26),
    '<path d="M546 648 H1127" stroke="url(#neon)" stroke-width="2"/>',
    '</g></svg>',
  );
  return parts.join('');
}
