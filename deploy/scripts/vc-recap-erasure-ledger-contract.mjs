/** 
 * Synthetic-only, side-effect-free contract for a future independent erasure ledger.
 * This does NOT write to AWS, authenticate S3 inventories, persist receipts,
 * retry failures, or authorize restarting VC Recap.
 *
 * See docs/VC_RECAP_ERASURE_LEDGER_DESIGN.md and Issue #694.
 */
export const ERASURE_EVENT_KIND = 'vc-recap-erasure-request-event-v1';
export const EXTERNAL_SNAPSHOT_KIND = 'vc-recap-independent-erasure-ledger-v1';

const OWNER_ID = /^[0-9]{15,22}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function utcTimestamp(value) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) {
    throw new Error('Invalid erasure ledger timestamp');
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('Invalid erasure ledger timestamp');
  // ISO parsing can silently normalize impossible calendar dates in some runtimes.
  const calendar = new Date(millis).toISOString().slice(0, 19);
  if (calendar !== value.slice(0, 19)) throw new Error('Invalid erasure ledger calendar date');
  return millis;
}

export function validateErasureReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      Object.keys(receipt).sort().join(',') !== 'kind,requestId,requestedAt,userId' ||
      receipt.kind !== ERASURE_EVENT_KIND ||
      !UUID_V4.test(receipt.requestId) ||
      typeof receipt.userId !== 'string' || !OWNER_ID.test(receipt.userId)) {
    throw new Error('Invalid erasure ledger receipt');
  }
  utcTimestamp(receipt.requestedAt);
  return Object.freeze({ ...receipt });
}

/**
 * Create a deterministic snapshot in the exact schema understood by the
 * existing read-only restore fence verifier. Inputs are not authoritative:
 * the eventual external store must independently authenticate object listing,
 * immutability, inventory completeness, and expected counts BEFORE calling.
 * Never pass this function's own length back as the "independent" audit.
 */
export function assembleErasureSnapshot(receipts, { generatedAt, independentlyAuditedCount } = {}) {
  if (!Array.isArray(receipts) || receipts.length > 100000 ||
      !Number.isSafeInteger(independentlyAuditedCount) ||
      independentlyAuditedCount < 0 || independentlyAuditedCount !== receipts.length) {
    throw new Error('Erasure ledger inventory is incomplete or unverified');
  }
  const generatedMillis = utcTimestamp(generatedAt);
  const ids = new Map();
  const latest = new Map();
  for (const untrusted of receipts) {
    const receipt = validateErasureReceipt(untrusted);
    const existing = ids.get(receipt.requestId);
    if (existing) {
      // Immutable per-request objects must not be rewritten or reused.
      throw new Error('Duplicate erasure ledger request identifier');
    }
    ids.set(receipt.requestId, true);
    const stamp = utcTimestamp(receipt.requestedAt);
    if (stamp > generatedMillis) throw new Error('Erasure request follows its snapshot');
    const previous = latest.get(receipt.userId);
    if (!previous || stamp > previous.millis) {
      latest.set(receipt.userId, { millis: stamp, requestedAt: receipt.requestedAt });
    }
  }

  return {
    kind: EXTERNAL_SNAPSHOT_KIND,
    generatedAt,
    entries: [...latest].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([userId, item]) => ({
      userId,
      requestedAt: item.requestedAt,
    })),
  };
}
