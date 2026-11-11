import { dailyServiceFetch } from './daily-bonus-wallet.js';
import type { DailyQuizResultAssetPool } from './daily-quiz-result-asset-selector.js';

/**
 * Client for the Web-owned Daily result-card contract (#920, consumed by
 * Herta #803):
 *
 *   POST /v2/participation/herta/result-card-config
 *     -> { contractVersion: 1, revision, activatedAt,
 *          correct: { assets: [{ assetId, alt, mimeType, byteSize }] },
 *          incorrect: { assets: [...] }, fallback: 'embed' }
 *     -> { contractVersion: 1, revision, unchanged: true, fallback: 'embed' }
 *        when the caller's knownRevision is still current.
 *   POST /v2/participation/herta/result-card-media  { assetId }
 *     -> raw image bytes for an asset in the active pool.
 *
 * Both routes reuse the Herta points signature via dailyServiceFetch, so the
 * body automatically carries { guildId, discordUserId, ...extra } — the
 * contract accepts no other keys. The config response has no `status: 'ok'`
 * field, so the shared `request()` wrapper cannot be used here.
 *
 * The contract never contains answer choices or explanations; assets are
 * presentation-only artwork registered from Admin.
 */

export interface DailyResultCardAssetMeta {
  assetId: string;
  alt: string;
  mimeType: string;
  byteSize: number;
}

export interface DailyResultCardConfig {
  revision: number;
  activatedAt: string | null;
  correctAssets: readonly DailyResultCardAssetMeta[];
  incorrectAssets: readonly DailyResultCardAssetMeta[];
  /** Selector-ready view of the same pools (revision stringified, enabled). */
  pool: DailyQuizResultAssetPool;
}

const CONFIG_PATH = '/v2/participation/herta/result-card-config';
const MEDIA_PATH = '/v2/participation/herta/result-card-media';
const MAX_MEDIA_BYTES = 10_485_760;
export const DAILY_RESULT_CARD_CONFIG_TTL_MS = 60_000;

let cachedConfig: { config: DailyResultCardConfig; fetchedAt: number } | null = null;
const mediaCache = new Map<string, Buffer>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAssetMeta(value: unknown): DailyResultCardAssetMeta | null {
  if (!isRecord(value)) return null;
  const { assetId, alt, mimeType, byteSize } = value;
  if (typeof assetId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(assetId)) return null;
  if (typeof alt !== 'string') return null;
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) return null;
  if (
    !Number.isSafeInteger(byteSize) ||
    (byteSize as number) <= 0 ||
    (byteSize as number) > MAX_MEDIA_BYTES
  )
    return null;
  return { assetId, alt, mimeType, byteSize: byteSize as number };
}

function parseAssetPool(value: unknown): DailyResultCardAssetMeta[] | null {
  if (!isRecord(value) || !Array.isArray(value.assets)) return null;
  const seen = new Set<string>();
  const assets: DailyResultCardAssetMeta[] = [];
  for (const entry of value.assets) {
    const meta = parseAssetMeta(entry);
    if (!meta || seen.has(meta.assetId)) return null;
    seen.add(meta.assetId);
    assets.push(meta);
  }
  return assets;
}

function parseConfig(value: Record<string, unknown>): DailyResultCardConfig | null {
  const { revision, activatedAt } = value;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return null;
  if (activatedAt !== null && typeof activatedAt !== 'string') return null;
  const correctAssets = parseAssetPool(value.correct);
  const incorrectAssets = parseAssetPool(value.incorrect);
  if (!correctAssets || !incorrectAssets) return null;
  const toSelectorAssets = (assets: readonly DailyResultCardAssetMeta[]) =>
    assets.map((asset) => ({ assetId: asset.assetId, alt: asset.alt, enabled: true }));
  return {
    revision: revision as number,
    activatedAt: activatedAt as string | null,
    correctAssets,
    incorrectAssets,
    pool: {
      revision: String(revision),
      correctAssets: toSelectorAssets(correctAssets),
      incorrectAssets: toSelectorAssets(incorrectAssets),
    },
  };
}

/**
 * Fetch the active result-card configuration, keeping a short-lived cache.
 * While the cache is fresh it is returned without a network call; once it
 * expires the cached revision is sent as knownRevision so an unchanged
 * configuration costs only the lightweight response. Any failure (network,
 * auth, malformed payload) returns null and the caller falls back to the
 * canonical text presentation.
 */
export async function fetchDailyResultCardConfig(
  guildId: string,
  userId: string,
  now: number = Date.now(),
): Promise<DailyResultCardConfig | null> {
  if (cachedConfig && now - cachedConfig.fetchedAt < DAILY_RESULT_CARD_CONFIG_TTL_MS) {
    return cachedConfig.config;
  }
  let response: Response | null;
  try {
    response = await dailyServiceFetch(
      guildId,
      userId,
      CONFIG_PATH,
      cachedConfig ? { knownRevision: cachedConfig.config.revision } : {},
    );
  } catch {
    return null;
  }
  if (!response?.ok) return null;
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(value) || value.contractVersion !== 1 || value.fallback !== 'embed') return null;
  if (value.unchanged === true) {
    if (!cachedConfig || value.revision !== cachedConfig.config.revision) return null;
    cachedConfig = { config: cachedConfig.config, fetchedAt: now };
    return cachedConfig.config;
  }
  const config = parseConfig(value);
  if (!config) return null;
  if (!cachedConfig || cachedConfig.config.revision !== config.revision) {
    // Artwork bytes are only valid for the revision that listed them.
    mediaCache.clear();
  }
  cachedConfig = { config, fetchedAt: now };
  return config;
}

/**
 * Fetch one pool asset's image bytes through the signed media route,
 * validating the response against the config metadata exactly like the
 * question-media path does. Bytes are cached per assetId and invalidated
 * whenever the configuration revision changes.
 */
export async function fetchDailyResultCardMedia(
  guildId: string,
  userId: string,
  meta: DailyResultCardAssetMeta,
): Promise<Buffer | null> {
  const hit = mediaCache.get(meta.assetId);
  if (hit) return hit;
  let response: Response | null;
  try {
    response = await dailyServiceFetch(guildId, userId, MEDIA_PATH, { assetId: meta.assetId });
  } catch {
    return null;
  }
  if (
    !response?.ok ||
    response.headers.get('X-IVRM-Media-Id') !== meta.assetId ||
    response.headers.get('Content-Type') !== meta.mimeType ||
    Number(response.headers.get('Content-Length')) !== meta.byteSize ||
    !response.headers.get('Cache-Control')?.includes('private') ||
    !response.headers.get('Cache-Control')?.includes('no-store') ||
    !response.body
  ) {
    return null;
  }
  try {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    if (total !== meta.byteSize) return null;
    const buffer = Buffer.concat(chunks);
    mediaCache.set(meta.assetId, buffer);
    return buffer;
  } catch {
    return null;
  }
}
