import type { ValorantPickCardInput } from './valorant-pick-card.js';

/**
 * Cinematic, text-first agent reveal. All remote portraits are bounded PNG
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

function solo(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const entry = input.entries[0]!;
  const art = portraits[0];
  const parts: string[] = [
    '<path d="M660 170 L1190 170 L1190 568 L520 568 Z" fill="#181b23"/>',
    '<path d="M815 165 H1190 V525 L1060 568 H590 Z" fill="#d72f43" opacity=".14"/>',
    '<path d="M1010 165 H1190 V565 H860 Z" fill="#ff4655" opacity=".19"/>',
    '<path d="M875 179 L1150 179 L1000 565 L720 565Z" fill="none" stroke="#fa4655" stroke-width="2" opacity=".35"/>',
    '<path d="M616 177 V562" stroke="#ff4655" stroke-width="2" opacity=".8"/>',
  ];
  // The portrait is deliberately behind the left reading surface and bottom HUD.
  if (art) {
    parts.push('<g clip-path="url(#solo-art)">');
    parts.push(portrait(art, 618, 159, 568, 430));
    parts.push('</g>');
  } else {
    parts.push(
      '<path d="M903 227 L1062 382 L903 537 L744 382Z" fill="#222831" stroke="#fb4e5a" stroke-width="3"/>',
      '<path d="M903 271 L1016 382 L903 493 L790 382Z" fill="#10141c" stroke="#888189" stroke-width="1.5"/>',
      text(entry.agentName.toUpperCase(), 770, 402, 40, '#fa6570', 800, 12),
    );
  }
  parts.push(
    '<path d="M38 166 H690 L595 570 H38Z" fill="url(#left-shade)"/>',
    '<rect x="52" y="189" width="4" height="60" fill="#ff4655"/>',
    text('01  /  HERO PICK', 72, 211, 18, '#fd6773', 750),
    text('SELECTED AGENT', 69, 277, 19, '#beb8b0', 650),
    text(entry.displayName, 65, 359, 71, '#f8f3e9', 850, 9),
    '<path d="M69 385 H555" stroke="#f04b59" stroke-width="2"/>',
    text(entry.agentName.toUpperCase(), 70, 417, 26, '#ff6270', 800, 17),
    text('PLAYER', 70, 473, 16, '#96979a', 700),
    text(entry.playerLabel ?? 'PLAYER 01', 70, 508, 28, '#f8f3e9', 700, 19),
    text('ROLE', 70, 542, 14, '#96979a', 700),
    text(roles[0] ?? 'エージェント', 130, 544, 20, '#ffb2ad', 700, 13),
    '<path d="M1172 189 v52 M1120 552 h52" stroke="#f6e8df" stroke-width="2" opacity=".75"/>',
  );
  return parts.join('');
}

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
    const nameLimit = count === 5 ? 7 : count === 4 ? 9 : count === 3 ? 12 : 17;
    const playerLimit = count === 5 ? 11 : count === 4 ? 15 : 23;
    parts.push(
      '<g>',
      '<rect x="' +
        x +
        '" y="184" width="' +
        width +
        '" height="380" fill="#1b2028" stroke="#66616a" stroke-width="1.5"/>',
      '<path d="M' +
        x +
        ' 184 H' +
        (x + width) +
        ' L' +
        (x + width - 42) +
        ' 439 H' +
        x +
        'Z" fill="#26242d"/>',
      '<path d="M' +
        (x + width * 0.48) +
        ' 189 L' +
        (x + width - 8) +
        ' 189 L' +
        (x + width * 0.6) +
        ' 439 L' +
        (x + 6) +
        ' 439Z" fill="#fc485b" opacity=".13"/>',
      '<clipPath id="lineup-art-' +
        i +
        '"><rect x="' +
        (x + 2) +
        '" y="188" width="' +
        (width - 4) +
        '" height="265"/></clipPath>',
    );
    if (art) {
      parts.push('<g clip-path="url(#lineup-art-' + i + ')">');
      parts.push(portrait(art, x - 16, 181, width + 32, 289));
      parts.push('</g>');
    } else {
      parts.push(
        '<path d="M' +
          (x + width / 2) +
          ' 240 l82 88 -82 88 -82 -88Z" fill="#21262f" stroke="#ed4c5c" stroke-width="2"/>',
        text(
          entry.agentName.toUpperCase(),
          x + 20,
          344,
          count >= 4 ? 21 : 28,
          '#e7a3a4',
          800,
          count >= 4 ? 10 : 18,
        ),
      );
    }
    parts.push(
      '<path d="M' + (x + 13) + ' 200 H' + (x + 77) + '" stroke="#ff4655" stroke-width="4"/>',
      '<rect x="' + (x + 11) + '" y="212" width="40" height="32" fill="#0c1016" opacity=".92"/>',
      text(String(i + 1).padStart(2, '0'), x + 17, 236, 19, '#f2e8df', 800, 2),
      '<rect x="' +
        (x + 2) +
        '" y="448" width="' +
        (width - 4) +
        '" height="114" fill="#10151c" opacity=".98"/>',
      '<path d="M' + (x + 2) + ' 448 H' + (x + width - 2) + '" stroke="#ff4655" stroke-width="3"/>',
      text(entry.displayName, x + 13, 491, nameFont, '#f7f1e7', 850, nameLimit),
      text(roles[i] ?? 'エージェント', x + 13, 518, 15, '#fb7780', 650, 12),
      '<path d="M' + (x + 13) + ' 530 H' + (x + width - 12) + '" stroke="#353a43"/>',
      text(
        entry.playerLabel ?? 'PLAYER ' + (i + 1),
        x + 13,
        551,
        playerFont,
        '#dcd6cf',
        650,
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
    '<linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#090c12"/><stop offset=".58" stop-color="#16191f"/><stop offset="1" stop-color="#0b0d13"/></linearGradient>',
    '<linearGradient id="left-shade" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#0d1118"/><stop offset=".82" stop-color="#0d1118" stop-opacity=".98"/><stop offset="1" stop-color="#0d1118" stop-opacity="0"/></linearGradient>',
    '<pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0 H0 V52" stroke="#a6a1a0" stroke-width=".7" stroke-opacity=".06" fill="none"/></pattern>',
    '<clipPath id="frame"><rect x="0" y="0" width="1200" height="680" rx="13"/></clipPath>',
    '<clipPath id="solo-art"><rect x="618" y="166" width="562" height="402"/></clipPath>',
    '</defs>',
    '<g clip-path="url(#frame)" font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, Arial, sans-serif">',
    '<rect width="1200" height="680" fill="url(#scene)"/>',
    '<rect width="1200" height="680" fill="url(#grid)"/>',
    '<path d="M770 0 H1200 V162 L1150 162 Z" fill="#e34251" opacity=".10"/>',
    '<path d="M0 0 H9 V680 H0Z" fill="#ff4655"/>',
    '<path d="M30 26 H1170 M30 656 H1170" stroke="#514a4a" stroke-width="1"/>',
    '<path d="M30 26 H160 M1040 656 H1170" stroke="#ff4655" stroke-width="3"/>',
  ];
  // Art is rendered first, then headers and metadata above it, regardless of portrait size.
  parts.push(count === 1 ? solo(input, portraits, roles) : squad(input, portraits, roles));
  parts.push(
    '<rect x="32" y="30" width="1136" height="125" fill="#0b0d13" opacity=".93"/>',
    text('HERTA  /  VALORANT', 52, 58, 18, '#ff6c75', 800),
    text('AGENT REVEAL', 52, 116, 53, '#f6f0e7', 850),
    text(
      count === 1 ? 'SOLO  //  HERO PICK' : 'SQUAD  //  LINEUP',
      885,
      82,
      18,
      '#a6a3a2',
      700,
      24,
    ),
    text('抽選完了', 1022, 125, 23, '#ff6d79', 750),
    '<path d="M52 151 H1148" stroke="#ff4655" stroke-width="2"/>',
    '<rect x="32" y="577" width="1136" height="77" fill="#0e1218" opacity=".99"/>',
    '<path d="M52 577 H1148" stroke="#ff4655" stroke-width="2"/>',
    text('MODE', 53, 600, 13, '#a8a3a1', 650),
    text(mode, 53, 632, 22, '#f1e9e0', 750, 11),
    text('MAP', 295, 600, 13, '#a8a3a1', 650),
    text(input.mapName, 295, 632, 22, '#f1e9e0', 750, 15),
    text('PARTICIPANTS', 598, 600, 13, '#a8a3a1', 650),
    text(count + ' / 5', 598, 632, 24, '#f1e9e0', 800),
    text('STATUS', 785, 600, 13, '#a8a3a1', 650),
    text('PICK COMPLETE', 785, 632, 17, '#ff7d83', 750),
    text(footer, 55, 675, 14, '#b4aaa7', 500, 37),
    '</g></svg>',
  );
  return parts.join('');
}
