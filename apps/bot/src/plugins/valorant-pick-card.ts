import sharp from 'sharp';
import { VALORANT_AGENTS } from '@herta/plugin-catalog';
import { renderValorantHudSvg } from './valorant-pick-card-hud.js';

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
      .resize(650, 550, { fit: 'contain' })
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
    const metadata = await loadMetadata();
    const portraitResults = await Promise.all(
      entries.map((entry) => agentPortrait(entry.agentName, metadata.get(entry.agentName))),
    );
    const svg = renderValorantHudSvg(
      input,
      portraitResults,
      entries.map((entry) => metadata.get(entry.agentName)?.role ?? 'エージェント'),
    );
    const png = await sharp(Buffer.from(svg), { limitInputPixels: 2_000_000 }).png().toBuffer();
    if (png.byteLength > 8 * 1024 * 1024) throw new Error('ValorantCardTooLarge');
    return png;
  } finally {
    activeRenders--;
  }
}
