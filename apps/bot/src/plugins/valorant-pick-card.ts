import sharp from 'sharp';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';

export interface ValorantPickCardEntry {
  agentName: string;
  displayName: string;
  playerLabel?: string;
}

export interface ValorantPickCardInput {
  mode: 'RANDOM' | 'TACTICAL';
  mapName: string;
  entries: readonly ValorantPickCardEntry[];
  planLabel?: string | null;
}

const AGENT_ALLOWLIST = new Set<string>(VALORANT_AGENTS);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const META_URL = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const ART_CACHE_MAX = 12;
const ART_TTL = 30 * 60_000;
const META_TTL = 30 * 60_000;
const MAX_ART_BYTES = 4 * 1024 * 1024;
const roleNames: Record<string, string> = {
  Duelist: 'デュエリスト',
  Controller: 'コントローラー',
  Initiator: 'イニシエーター',
  Sentinel: 'センチネル',
};
type Metadata = { uuid: string; role: string };
let metadataPromise: Promise<Map<string, Metadata>> | null = null;
let metadataExpiresAt = 0;
const artCache = new Map<string, { image: Buffer; expiresAt: number }>();
let activeRenders = 0;

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
}

function safeLabel(value: string, max = 18): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return escapeXml(Array.from(clean).slice(0, max).join('') || 'PLAYER');
}

async function boundedResponse(url: string, limit: number, ms: number): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(ms),
      headers: { accept: 'image/png,application/json' },
    });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > limit) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (!response.body) return null;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > limit) {
        await response.body.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  } catch {
    return null;
  }
}

async function loadMetadata(): Promise<Map<string, Metadata>> {
  if (metadataPromise && Date.now() < metadataExpiresAt) return metadataPromise;
  metadataExpiresAt = Date.now() + META_TTL;
  metadataPromise = (async () => {
    const bytes = await boundedResponse(META_URL, 1_000_000, 1_900);
    if (!bytes) return new Map<string, Metadata>();
    try {
      const result: unknown = JSON.parse(bytes.toString('utf8'));
      if (!result || typeof result !== 'object' || !('data' in result)) return new Map();
      const data = (result as { data?: unknown }).data;
      if (!Array.isArray(data)) return new Map();
      const items = new Map<string, Metadata>();
      for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (
          typeof row.displayName !== 'string' ||
          !AGENT_ALLOWLIST.has(row.displayName) ||
          typeof row.uuid !== 'string' ||
          !UUID.test(row.uuid)
        )
          continue;
        const role = row.role;
        const roleName =
          role && typeof role === 'object' && 'displayName' in role
            ? (role as { displayName?: unknown }).displayName
            : undefined;
        items.set(row.displayName, {
          uuid: row.uuid,
          role:
            typeof roleName === 'string' && roleNames[roleName]
              ? roleNames[roleName]
              : 'エージェント',
        });
      }
      return items;
    } catch {
      return new Map();
    }
  })();
  return metadataPromise;
}

async function agentPortrait(name: string, metadata: Metadata | undefined): Promise<Buffer | null> {
  if (!AGENT_ALLOWLIST.has(name) || !metadata) return null;
  const cached = artCache.get(metadata.uuid);
  if (cached && cached.expiresAt > Date.now()) return cached.image;
  const url = 'https://media.valorant-api.com/agents/' + metadata.uuid + '/fullportrait.png';
  const raw = await boundedResponse(url, MAX_ART_BYTES, 2_100);
  if (!raw) return null;
  try {
    const image = await sharp(raw, { limitInputPixels: 20_000_000 })
      .resize(460, 440, { fit: 'contain', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (artCache.size >= ART_CACHE_MAX) artCache.delete(artCache.keys().next().value!);
    artCache.set(metadata.uuid, { image, expiresAt: Date.now() + ART_TTL });
    return image;
  } catch {
    return null;
  }
}

/**
 * Bounded CPU/memory rendering. All network URLs are fixed or built from
 * UUID-validated catalog metadata; no player IDs/user text are ever sent out.
 * Failure to fetch art leaves a legible, styled card with names and roles.
 */
export async function renderValorantPickCard(input: ValorantPickCardInput): Promise<Buffer> {
  if (activeRenders >= 2) throw new Error('ValorantCardBusy');
  if (input.entries.length < 1 || input.entries.length > 5)
    throw new RangeError('VALORANT card requires 1..5 agents');
  activeRenders++;
  try {
    const entries = input.entries;
    const count = entries.length;
    const width = 1200;
    const height = 680;
    const gap = count < 3 ? 22 : 12;
    const cardWidth =
      count === 1 ? 460 : count === 2 ? 430 : Math.floor((1104 - gap * (count - 1)) / count);
    const left = (width - (count * cardWidth + (count - 1) * gap)) / 2;
    const metadata = await loadMetadata();
    const portraitResults = await Promise.all(
      entries.map((entry) => agentPortrait(entry.agentName, metadata.get(entry.agentName))),
    );
    const label = (
      value: string,
      x: number,
      y: number,
      size: number,
      fill = '#f7f4ff',
      weight = 700,
    ) =>
      '<text x="' +
      x +
      '" y="' +
      y +
      '" fill="' +
      fill +
      '" font-size="' +
      size +
      '" font-weight="' +
      weight +
      '">' +
      safeLabel(value, 32) +
      '</text>';
    const elements: string[] = [];
    for (let i = 0; i < count; i++) {
      const entry = entries[i]!;
      const x = left + i * (cardWidth + gap);
      const portrait = portraitResults[i];
      const fontSize = count >= 4 ? 24 : count === 3 ? 29 : 37;
      const nameSize = count >= 4 ? 17 : 23;
      const role = metadata.get(entry.agentName)?.role ?? 'エージェント';
      const imageAreaTop = 190;
      elements.push('<g>');
      elements.push(
        '<rect x="' +
          x +
          '" y="168" width="' +
          cardWidth +
          '" height="432" rx="18" fill="#22263a" stroke="#6d607f" stroke-opacity="0.9" stroke-width="2"/>',
      );
      elements.push(
        '<rect x="' +
          (x + 4) +
          '" y="172" width="' +
          (cardWidth - 8) +
          '" height="421" rx="15" fill="url(#tile)"/>',
      );
      elements.push(
        '<path d="M' +
          (x + cardWidth * 0.35) +
          ' 180 L' +
          (x + cardWidth - 16) +
          ' 180 L' +
          (x + cardWidth * 0.7) +
          ' 580" fill="#ff536b" opacity=".12"/>',
      );
      elements.push(
        '<text x="' +
          (x + 22) +
          '" y="212" fill="#ff6579" font-size="20" font-weight="800">0' +
          (i + 1) +
          '</text>',
      );
      if (portrait) {
        const dataUrl = 'data:image/png;base64,' + portrait.toString('base64');
        const artW = Math.min(cardWidth - 16, 400);
        const artX = x + (cardWidth - artW) / 2;
        elements.push(
          '<image href="' +
            dataUrl +
            '" x="' +
            artX +
            '" y="' +
            imageAreaTop +
            '" width="' +
            artW +
            '" height="326" preserveAspectRatio="xMidYMid meet"/>',
        );
      } else {
        elements.push(
          '<path d="M' +
            (x + cardWidth / 2) +
            ' 256 l70 90 -70 90 -70 -90z" fill="none" stroke="#ff6179" stroke-width="3" opacity=".25"/>',
        );
        elements.push(
          label(
            entry.agentName.slice(0, 2).toUpperCase(),
            x + 33,
            380,
            count >= 4 ? 41 : 60,
            '#7b718f',
          ),
        );
      }
      elements.push(
        '<rect x="' +
          (x + 4) +
          '" y="473" width="' +
          (cardWidth - 8) +
          '" height="120" fill="#121826" opacity=".95"/>',
      );
      elements.push('<rect x="' + (x + 4) + '" y="473" width="4" height="120" fill="#ff4d69"/>');
      elements.push(label(entry.displayName, x + 17, 518, fontSize));
      elements.push(label(role, x + 17, 547, 15, '#ff95a5', 500));
      elements.push(
        label(entry.playerLabel ?? 'PLAYER 0' + (i + 1), x + 17, 579, nameSize, '#c6b9ff', 600),
      );
      elements.push('</g>');
    }
    const title = input.mode === 'TACTICAL' ? 'TACTICAL AGENT COMPOSITION' : 'RANDOM AGENT PICK';
    const subtitle = input.mode === 'TACTICAL' ? '実戦向け構成' : '完全ランダム';
    const footer = input.planLabel ? '構成の特徴: ' + input.planLabel : 'HERTA / VALORANT PICK';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      width +
      '" height="' +
      height +
      '">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111522"/><stop offset=".5" stop-color="#1f2035"/><stop offset="1" stop-color="#10121f"/></linearGradient>' +
      '<linearGradient id="tile" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#332940"/><stop offset="1" stop-color="#171b2b"/></linearGradient></defs>' +
      '<rect width="1200" height="680" rx="22" fill="url(#bg)"/>' +
      '<path d="M855 0 L1200 0 L1200 330 L1090 330Z" fill="#fb5368" opacity=".10"/>' +
      '<path d="M0 0 L20 0 L20 680 L0 680Z" fill="#fb5368"/>' +
      '<g font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, sans-serif">' +
      label('HERTA • VALORANT', 50, 54, 25, '#ff7187') +
      label(title, 50, 105, 42) +
      label(
        subtitle + '  /  ' + input.mapName + '  /  ' + count + '人',
        52,
        144,
        24,
        '#c9c3db',
        500,
      ) +
      elements.join('') +
      '<path d="M50 620 H1150" stroke="#6b667d" stroke-opacity=".5"/>' +
      label(footer, 52, 657, 21, '#d2c3e5', 500) +
      label('PICK COMPLETE', 976, 657, 18, '#ff7a90') +
      '</g></svg>';
    const png = await sharp(Buffer.from(svg), { limitInputPixels: 2_000_000 }).png().toBuffer();
    if (png.byteLength > 8 * 1024 * 1024) throw new Error('ValorantCardTooLarge');
    return png;
  } finally {
    activeRenders--;
  }
}
