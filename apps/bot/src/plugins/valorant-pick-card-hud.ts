import type { ValorantPickCardInput } from './valorant-pick-card.js';

/**
 * Decorative, text-first esports HUD. Portraits are optional and are supplied only
 * after allowlisted metadata, bounded download, and Sharp decoding in the caller.
 * Keep every dynamic string XML-escaped; the renderer must never use foreignObject.
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
  fill = '#f5f5f9',
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

function metric(x: number, width: number, heading: string, value: string, max: number): string {
  return (
    '<g>' +
    '<rect x="' +
    x +
    '" y="193" width="' +
    width +
    '" height="86" rx="5" fill="#191f30" stroke="#4f4055" stroke-opacity=".8"/>' +
    '<path d="M' +
    (x + 14) +
    ' 207 v-7 h26" stroke="#ff546c" stroke-width="2" fill="none"/>' +
    text(heading, x + 22, 222, 17, '#a7afc0', 500) +
    text(value, x + 22, 257, 25, '#fffaff', 700, max) +
    '</g>'
  );
}

function imageTag(image: Buffer | null | undefined, x: number, y: number, w: number, h: number) {
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

function singleHero(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const entry = input.entries[0]!;
  const art = portraits[0];
  const parts: string[] = [];
  parts.push(
    '<rect x="655" y="319" width="509" height="278" rx="14" fill="#1a172c" opacity=".55"/>',
  );
  parts.push('<path d="M730 335 L1185 205 L1185 596 L845 596Z" fill="#ff415e" opacity=".11"/>');
  parts.push(
    '<path d="M760 346 L1150 252 M820 580 L1185 480" stroke="#e94464" opacity=".22" stroke-width="2"/>',
  );
  if (art) {
    parts.push(imageTag(art, 650, 105, 520, 526));
  } else {
    // No portrait/network: deliberate visual treatment rather than broken-image UI.
    parts.push(
      '<path d="M905 318 l164 137 -164 133 -163 -133Z" fill="#2f283f" stroke="#fd566b" stroke-width="3" stroke-opacity=".65"/>',
    );
    parts.push(
      '<path d="M905 361 l116 95 -116 96 -114 -96Z" fill="#121828" stroke="#7f668e" stroke-width="2"/>',
    );
    parts.push(text(entry.agentName.toUpperCase(), 768, 477, 46, '#ed7b96', 800, 13));
  }
  parts.push(
    '<rect x="51" y="356" width="590" height="232" rx="6" fill="#111724" stroke="#484254"/>',
  );
  parts.push(
    '<path d="M51 356 h184 M51 356 v28 M641 588 h-140" stroke="#ff526c" stroke-width="4" fill="none"/>',
  );
  parts.push(text('PLAYER', 75, 398, 18, '#a9afc0', 600));
  parts.push(text(entry.playerLabel ?? 'PLAYER 01', 75, 443, 32, '#d9ccff', 700, 24));
  parts.push('<path d="M75 466 H613" stroke="#505069" stroke-width="1"/>');
  parts.push(text('SELECTED AGENT', 75, 499, 17, '#ff6b83', 700));
  parts.push(text(entry.displayName, 73, 555, 53, '#ffffff', 800, 13));
  parts.push(text(roles[0] ?? 'エージェント', 412, 552, 20, '#c7b9df', 500, 12));
  parts.push(text(entry.agentName.toUpperCase(), 688, 599, 30, '#ffc0cc', 800, 15));
  parts.push(text('01 / HERO PICK', 68, 327, 16, '#a9abc2', 600));
  return parts.join('');
}

function squad(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const gap = count === 2 ? 22 : 13;
  const width = (1094 - gap * (count - 1)) / count;
  const left = 53;
  const output: string[] = [];
  for (let index = 0; index < count; index++) {
    const entry = input.entries[index]!;
    const x = left + index * (width + gap);
    const role = roles[index] ?? 'エージェント';
    const font = count >= 5 ? 25 : count === 4 ? 28 : 34;
    const playerFont = count >= 5 ? 15 : count === 4 ? 17 : 20;
    const art = portraits[index];
    output.push('<g>');
    output.push(
      '<rect x="' +
        x +
        '" y="331" width="' +
        width +
        '" height="265" rx="7" fill="url(#panel)" stroke="#5b455e" stroke-width="2"/>',
    );
    output.push(
      '<path d="M' +
        (x + 9) +
        ' 340 H' +
        (x + Math.min(width - 12, 96)) +
        ' M' +
        (x + 9) +
        ' 340 V363" stroke="#ff5069" stroke-width="3" fill="none"/>',
    );
    output.push(
      '<path d="M' +
        (x + width - 16) +
        ' 343 L' +
        (x + width * 0.35) +
        ' 519 L' +
        (x + width - 13) +
        ' 519" fill="#f84b66" opacity=".12"/>',
    );
    if (art) {
      output.push(imageTag(art, x + 8, 338, width - 16, 188));
    } else {
      output.push(
        '<path d="M' +
          (x + width / 2) +
          ' 365 l54 66 -54 66 -54 -66z" fill="#1e2335" stroke="#ff637b" stroke-opacity=".45" stroke-width="2"/>',
      );
      output.push(
        text(entry.agentName.toUpperCase(), x + 18, 448, count >= 4 ? 21 : 29, '#af829c', 700, 13),
      );
    }
    output.push(
      '<rect x="' +
        (x + 2) +
        '" y="502" width="' +
        (width - 4) +
        '" height="91" fill="#101724" opacity=".96"/>',
    );
    output.push('<rect x="' + (x + 2) + '" y="502" width="4" height="91" fill="#ff526c"/>');
    output.push(text('0' + (index + 1), x + 15, 365, 18, '#ff798c', 800));
    output.push(text(entry.displayName, x + 15, 539, font, '#fff7fd', 800, count >= 5 ? 6 : 12));
    output.push(text(role, x + 16, 563, 14, '#ff90a1', 500, count >= 5 ? 9 : 16));
    output.push(
      text(
        entry.playerLabel ?? 'PLAYER 0' + (index + 1),
        x + 16,
        584,
        playerFont,
        '#c9c4ff',
        600,
        count >= 5 ? 10 : count === 4 ? 13 : 22,
      ),
    );
    output.push('</g>');
  }
  return output.join('');
}

export function renderValorantHudSvg(
  input: ValorantPickCardInput,
  portraits: readonly (Buffer | null)[],
  roles: readonly string[],
): string {
  const count = input.entries.length;
  const mode = input.mode === 'TACTICAL' ? '実戦向け構成' : '完全ランダム';
  const title = input.mode === 'TACTICAL' ? 'TACTICAL COMPOSITION' : 'AGENT DRAW';
  const footer = input.planLabel ? '構成の特徴：' + input.planLabel : 'HERTA  /  AGENT SELECTION';
  const parts: string[] = [];
  parts.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">' +
      '<defs>' +
      '<linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b101d"/><stop offset=".58" stop-color="#1c1c2d"/><stop offset="1" stop-color="#0d1324"/></linearGradient>' +
      '<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2f253c"/><stop offset=".55" stop-color="#1c2134"/><stop offset="1" stop-color="#141927"/></linearGradient>' +
      '<pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0 H0 V60" fill="none" stroke="#8990a8" stroke-opacity=".07"/></pattern>' +
      '<clipPath id="bounds"><rect width="1200" height="680" rx="18"/></clipPath>' +
      '</defs>' +
      '<g clip-path="url(#bounds)">' +
      '<rect width="1200" height="680" fill="url(#background)"/>' +
      '<rect width="1200" height="680" fill="url(#grid)"/>' +
      '<path d="M980 0 L1200 0 V360 L1060 305Z" fill="#fb5067" opacity=".13"/>' +
      '<path d="M1120 0 L1200 0 L1200 265Z" fill="#e34f74" opacity=".20"/>' +
      '<path d="M0 0 H8 V680 H0Z" fill="#ff4965"/>' +
      '<path d="M26 19 H1178 M26 661 H1178" stroke="#55435b" stroke-width="2"/>' +
      '<path d="M45 25 H145 M1040 25 H1155" stroke="#ff4965" stroke-width="3"/>' +
      '<g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">',
  );
  parts.push(text('HERTA  /  VALORANT', 53, 62, 20, '#fd7186', 700));
  parts.push(text(title, 940, 62, 17, '#99a5bd', 700));
  parts.push(text('VALORANT', 53, 135, 50, '#fc586f', 850));
  parts.push(text('エージェント抽選', 360, 132, 40, '#ffffff', 800));
  parts.push('<path d="M55 155 H1148" stroke="#6c536a" stroke-opacity=".75"/>');
  parts.push(metric(53, 264, 'MODE / モード', mode, 12));
  parts.push(metric(330, 304, 'MAP / マップ', input.mapName, 15));
  parts.push(metric(647, 235, 'PARTICIPANTS', count + ' / 5', 8));
  parts.push(
    '<rect x="900" y="193" width="246" height="86" rx="5" fill="#2e1a2b" stroke="#aa3a52"/>' +
      text('STATUS', 921, 221, 17, '#ff8da2', 600) +
      text('抽選完了', 921, 256, 26, '#ffffff', 800),
  );
  parts.push('<path d="M53 297 H1147" stroke="#f54b68" stroke-opacity=".68"/>');
  parts.push(
    text(
      count === 1 ? 'DRAW RESULT  /  SOLO' : 'DRAW RESULT  /  SQUAD',
      55,
      322,
      17,
      '#ff7187',
      700,
    ),
  );
  parts.push(count === 1 ? singleHero(input, portraits, roles) : squad(input, portraits, roles));
  parts.push('<path d="M53 613 H1146" stroke="#7a536d" stroke-opacity=".65"/>');
  parts.push(text(footer, 55, 644, 21, '#c8bdde', 500, 40));
  parts.push(text('PICK COMPLETE', 969, 645, 18, '#ff8c9c', 700));
  parts.push('</g></g></svg>');
  return parts.join('');
}
