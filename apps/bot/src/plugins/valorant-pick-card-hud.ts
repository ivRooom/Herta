import type { ValorantPickCardInput } from './valorant-pick-card.js';

/**
 * Neon Herta agent reveal (v4). All remote portraits are bounded PNG
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
 * Neon Herta hero: the agent art remains the focal point, while fixed-position
 * labels stay on an independent glass surface. User strings never enter SVG
 * attributes or URLs.
 */
function solo(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const entry = input.entries[0]!;
  const agentFont = Math.min(86, Math.floor(510 / Math.max(1, Array.from(entry.agentName).length * 0.66)));
  const parts: string[] = [
    '<path d="M620 158 H1189 V591 H557Z" fill="#1c123b" opacity=".72"/>',
    '<path d="M905 157 H1190 V590 H714Z" fill="#a82375" opacity=".25"/>',
    '<circle cx="923" cy="350" r="256" fill="url(#halo)" opacity=".88"/>',
    '<path d="M1048 154 L1187 154 V358 L1139 358Z" fill="#ff478d" opacity=".15"/>',
    '<path d="M1170 169 L1023 578" stroke="#fa5da5" stroke-width="2" opacity=".58"/>',
    '<path d="M700 173 L1171 173" stroke="#b05cff" stroke-width="2" opacity=".6"/>',
  ];
  if (portraits[0]) {
    parts.push(
      '<g clip-path="url(#solo-art)">',
      portrait(portraits[0], 591, 135, 650, 474),
      '</g>',
    );
  } else {
    parts.push(
      '<circle cx="946" cy="369" r="178" fill="#251b48" stroke="#a16bff" stroke-width="2"/>',
      '<circle cx="946" cy="369" r="147" fill="none" stroke="#ff5b9c" stroke-width="2" opacity=".6"/>',
      '<path d="M946 223 L1091 365 L946 512 L802 365 Z" fill="#19162f" stroke="#d25bef" stroke-width="3"/>',
      '<path d="M946 268 L1045 365 L946 467 L847 365 Z" fill="#0b0c1d"/>',
      text(entry.agentName.toUpperCase(), 804, 384, 32, '#efb3ff', 850, 15),
    );
  }
  parts.push(
    '<rect x="36" y="162" width="680" height="427" rx="23" fill="url(#reading)"/>',
    '<rect x="47" y="173" width="642" height="399" rx="20" fill="url(#glass)" stroke="url(#neon)" stroke-width="1.6"/>',
    '<path d="M70 201 H160" stroke="#ff5b9b" stroke-width="4" filter="url(#edge-glow)"/>',
    '<path d="M70 201 H160" stroke="#ff6aab" stroke-width="2.5"/>',
    text('01 / HERO PICK', 72, 238, 16, '#e3adff', 800),
    text('SELECTED AGENT', 72, 288, 14, '#ada9cc', 750),
    text(entry.agentName.toUpperCase(), 67, 381, agentFont, '#fff7ff', 900, 19),
    text(entry.displayName, 73, 420, 25, '#f6bbff', 750, 18),
    '<path d="M72 446 H574" stroke="#a266df" stroke-width="1.5" opacity=".8"/>',
    '<rect x="71" y="461" width="516" height="68" rx="12" fill="#15152e" opacity=".88"/>',
    '<path d="M71 462 V529" stroke="#ff4c9a" stroke-width="4"/>',
    text('PLAYER', 89, 483, 13, '#bcb6da', 750),
    text(entry.playerLabel ?? 'PLAYER 01', 88, 517, 27, '#f9f5ff', 750, 17),
    text('ROLE', 73, 559, 13, '#bcb6da', 750),
    text(roles[0] ?? 'エージェント', 145, 559, 19, '#ff8dca', 750, 13),
    '<path d="M650 191 V236 M627 214 H673" stroke="#ffa6da" stroke-width="1.5" opacity=".55"/>',
  );
  return parts.join('');
}

/**
 * Framed neon lineup: portrait surfaces are large, and the translucent
 * typographic footers prevent agent/player/role labels from colliding with art.
 */
function squad(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const gap = count === 2 ? 18 : 12;
  const width = (1096 - gap * (count - 1)) / count;
  const parts: string[] = [];
  const highlights = ['#ff589c', '#ad71ff', '#e56aff', '#ff6aa7', '#8c85ff'];
  for (let i = 0; i < count; i++) {
    const x = 52 + i * (width + gap);
    const entry = input.entries[i]!;
    const nameFont = count === 5 ? 25 : count === 4 ? 29 : 37;
    const playerFont = count === 5 ? 17 : count === 4 ? 19 : 21;
    const nameLimit = Math.max(1, Math.floor((width - 28) / nameFont));
    const playerLimit = Math.max(1, Math.floor((width - 28) / playerFont));
    const fallbackFont = count >= 4 ? 20 : 28;
    const fallbackLimit = Math.max(1, Math.floor((width - 38) / fallbackFont));
    const artWidth = Math.max(width + 36, Math.min(560, width * 1.5));
    const artX = x + (width - artWidth) / 2;
    parts.push(
      '<g>',
      '<rect x="' +
        x +
        '" y="165" width="' +
        width +
        '" height="424" rx="17" fill="#181832" stroke="' +
        highlights[i] +
        '" stroke-width="5" opacity=".25" filter="url(#edge-glow)"/>',
      '<rect x="' +
        x +
        '" y="165" width="' +
        width +
        '" height="424" rx="17" fill="url(#panel)" stroke="' +
        highlights[i] +
        '" stroke-width="1.6"/>',
      '<path d="M' +
        (x + width * 0.5) +
        ' 166 H' +
        (x + width - 2) +
        ' V412 H' +
        x +
        'Z" fill="#b842a0" opacity=".16"/>',
      '<clipPath id="lineup-art-' +
        i +
        '"><rect x="' +
        (x + 2) +
        '" y="170" width="' +
        (width - 4) +
        '" height="319" rx="11"/></clipPath>',
    );
    if (portraits[i]) {
      parts.push(
        '<g clip-path="url(#lineup-art-' + i + ')">',
        portrait(portraits[i], artX, 169, artWidth, 336),
        '</g>',
      );
    } else {
      parts.push(
        '<circle cx="' +
          (x + width / 2) +
          '" cy="327" r="' +
          Math.min(100, width * 0.38) +
          '" fill="#29204f" stroke="' +
          highlights[i] +
          '" stroke-width="2" opacity=".85"/>',
        '<path d="M' +
          (x + width / 2) +
          ' 227 l' +
          width * 0.32 +
          ' 99 -' +
          width * 0.32 +
          ' 100 -' +
          width * 0.32 +
          ' -100 Z" fill="#111329" stroke="' +
          highlights[i] +
          '" stroke-width="2"/>',
        text(entry.agentName.toUpperCase(), x + 16, 338, fallbackFont, '#ead0ff', 850, fallbackLimit),
      );
    }
    parts.push(
      '<rect x="' +
        (x + 2) +
        '" y="403" width="' +
        (width - 4) +
        '" height="184" rx="15" fill="url(#card-foot)"/>',
      '<rect x="' +
        (x + 12) +
        '" y="177" width="45" height="34" rx="9" fill="#101129" stroke="' +
        highlights[i] +
        '" stroke-opacity=".8"/>',
      text(String(i + 1).padStart(2, '0'), x + 19, 202, 19, '#fff3ff', 900, 2),
      '<path d="M' +
        (x + 15) +
        ' 440 H' +
        (x + width - 16) +
        '" stroke="' +
        highlights[i] +
        '" stroke-width="2"/>',
      text(entry.displayName, x + 15, 490, nameFont, '#fff7ff', 850, nameLimit),
      text(roles[i] ?? 'エージェント', x + 15, 522, 15, '#efacff', 750, 12),
      '<path d="M' +
        (x + 15) +
        ' 534 H' +
        (x + width - 16) +
        '" stroke="#8e71b2" stroke-opacity=".45"/>',
      text(
        entry.playerLabel ?? 'PLAYER ' + (i + 1),
        x + 15,
        560,
        playerFont,
        '#f3eaff',
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
  const footer = input.planLabel ? '構成：' + input.planLabel : 'HERTA.  /  PLAY TOGETHER';
  const parts: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">',
    '<defs>',
    '<linearGradient id="scene" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#080a20"/><stop offset=".55" stop-color="#15102c"/><stop offset="1" stop-color="#0a102c"/></linearGradient>',
    '<radialGradient id="halo"><stop stop-color="#db3fa7" stop-opacity=".6"/><stop offset=".48" stop-color="#8841d5" stop-opacity=".28"/><stop offset="1" stop-color="#4b2dbb" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="reading" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#0b0e25" stop-opacity=".96"/><stop offset=".82" stop-color="#15122f" stop-opacity=".9"/><stop offset="1" stop-color="#1b1940" stop-opacity=".22"/></linearGradient>',
    '<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1e204b" stop-opacity=".78"/><stop offset="1" stop-color="#0a0a20" stop-opacity=".44"/></linearGradient>',
    '<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#24204f"/><stop offset=".68" stop-color="#14162e"/><stop offset="1" stop-color="#111028"/></linearGradient>',
    '<linearGradient id="card-foot" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#101126" stop-opacity="0"/><stop offset=".19" stop-color="#141127" stop-opacity=".96"/><stop offset="1" stop-color="#0a0b1c"/></linearGradient>',
    '<linearGradient id="neon" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff659f"/><stop offset=".42" stop-color="#b568ff"/><stop offset="1" stop-color="#765aff"/></linearGradient>',
    '<filter id="edge-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>',
    '<clipPath id="frame"><rect width="1200" height="680" rx="12"/></clipPath>',
    '<clipPath id="solo-art"><rect x="609" y="157" width="591" height="428"/></clipPath>',
    '</defs>',
    '<g clip-path="url(#frame)" font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, Arial, sans-serif">',
    '<rect width="1200" height="680" fill="url(#scene)"/>',
    '<circle cx="1053" cy="153" r="325" fill="url(#halo)" opacity=".65"/>',
    '<circle cx="70" cy="605" r="252" fill="url(#halo)" opacity=".32"/>',
    '<path d="M825 0 H1030 L858 218 H670Z" fill="#7a4ee1" opacity=".09"/>',
    '<path d="M1075 0 H1200 V240 L1000 115Z" fill="#ff4f9b" opacity=".15"/>',
    '<path d="M0 476 L168 680 H0Z" fill="#d938b2" opacity=".11"/>',
    '<path d="M0 8 H186 M972 9 H1200 M0 671 H110 M970 671 H1200" stroke="url(#neon)" stroke-width="2" opacity=".7"/>',
    '<path d="M790 0 L660 139 M836 0 L703 139 M1000 540 L1117 680" stroke="#b04dcb" stroke-opacity=".22" stroke-width="2"/>',
    '<path d="M0 0 H7 V680 H0Z" fill="url(#neon)"/>',
  ];
  parts.push(count === 1 ? solo(input, portraits, roles) : squad(input, portraits, roles));
  parts.push(
    '<rect x="22" y="17" width="1156" height="125" rx="18" fill="#090b21" opacity=".91"/>',
    '<circle cx="64" cy="50" r="23" fill="#34215c" stroke="url(#neon)" stroke-width="2.5"/>',
    text('H', 55, 61, 29, '#f9d7ff', 900, 2),
    text('Herta.', 101, 60, 32, '#f3dcff', 900, 8),
    '<rect x="208" y="29" width="64" height="27" rx="9" fill="#4735c4"/>',
    text('BOT', 223, 48, 14, '#fff', 850, 3),
    text('DISCORD BOT FOR GAMERS', 102, 83, 11, '#bcb2e4', 650, 26),
    text('AGENT REVEAL', 52, 132, 38, '#fff7ff', 900),
    text(count === 1 ? 'SOLO // HERO PICK' : 'SQUAD // LINEUP', 787, 73, 18, '#d5c6f7', 750, 24),
    '<rect x="1022" y="91" width="124" height="33" rx="10" fill="#b33880" opacity=".9"/>',
    text('抽選完了', 1040, 115, 18, '#fff3fa', 800, 8),
    '<path d="M47 148 H1153" stroke="url(#neon)" stroke-width="2"/>',
    '<rect x="22" y="597" width="1156" height="75" rx="16" fill="#0b0e26" stroke="#8262cb" stroke-width="1.4"/>',
    '<path d="M47 597 H1153" stroke="url(#neon)" stroke-width="2"/>',
    text('MODE', 53, 619, 12, '#aba7d1', 700),
    text(mode, 53, 646, 19, '#f8f1ff', 750, 12),
    text('MAP', 300, 619, 12, '#aba7d1', 700),
    text(input.mapName, 300, 646, 19, '#f8f1ff', 750, 16),
    text('PARTICIPANTS', 575, 619, 12, '#aba7d1', 700),
    text(count + ' / 5', 575, 646, 19, '#f8f1ff', 850),
    text('STATUS', 804, 619, 12, '#aba7d1', 700),
    text('PICK COMPLETE', 804, 646, 17, '#ff91cc', 800),
    text(footer, 54, 665, 12, '#bdabe0', 550, 38),
    '</g></svg>',
  );
  return parts.join('');
}
