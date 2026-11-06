import { createHash } from 'node:crypto';

/**
 * Result images are presentation-only assets. This module never reads answer
 * choices, mutates a receipt, or fetches remote image URLs.
 */
export type DailyQuizResult = 'correct' | 'incorrect';

export type DailyQuizResultAsset = {
  assetId: string;
  alt: string;
  enabled: boolean;
};

export type DailyQuizResultAssetPool = {
  revision: string;
  correctAssets: readonly DailyQuizResultAsset[];
  incorrectAssets: readonly DailyQuizResultAsset[];
};

/**
 * Choose one active asset with approximately uniform probability over stable
 * receipt IDs. Repeated rendering/retries of a committed receipt keep the same
 * result for the same pool revision, without writing to the wallet/ledger.
 *
 * Only call this after the server has already finalized correctness. Do not
 * use an uncommitted click ID or a changing render timestamp as the seed.
 */
export function selectDailyQuizResultAsset(
  pool: DailyQuizResultAssetPool,
  result: DailyQuizResult,
  finalizedReceiptId: string,
): DailyQuizResultAsset | null {
  if (!pool.revision.trim() || !finalizedReceiptId.trim()) {
    return null;
  }
  const assets = result === 'correct' ? pool.correctAssets : pool.incorrectAssets;
  const seen = new Set<string>();
  const eligible = assets.filter((asset) => {
    const id = asset.assetId.trim();
    if (!asset.enabled || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (eligible.length === 0) return null;

  // Avoid leaking the receipt identity in logs or remote URLs. Domain-separate
  // the two outcomes and configuration revisions to prevent accidental reuse.
  const digest = createHash('sha256')
    .update('ivrm-daily-quiz-result-asset-v1\0')
    .update(result)
    .update('\0')
    .update(pool.revision)
    .update('\0')
    .update(finalizedReceiptId)
    .digest();
  const choice = Number(digest.readBigUInt64BE(0) % BigInt(eligible.length));
  return eligible[choice] ?? null;
}
