import { createHash } from 'node:crypto';
import { validateErasureReceipt } from './vc-recap-erasure-ledger-contract.mjs';

/**
 * A protocol boundary for future API/Discord/Studio erasure entrypoints.
 * No live callers, AWS SDK credentials or database writes are included.
 *
 * All three injected actions must implement durable, cross-instance behavior.
 * In particular, quarantine must survive process crashes and DB restores,
 * and must be enforced by every reader, writer and exporter (#695).
 */
export async function acceptVcRecapErasureWriteFirst(receipt, operations) {
  const valid = validateErasureReceipt(receipt);
  if (
    !operations ||
    typeof operations.quarantineOwner !== 'function' ||
    typeof operations.appendImmutableReceipt !== 'function' ||
    typeof operations.applyDatabaseFence !== 'function'
  ) {
    throw new Error('Independent erasure backend is not fully configured');
  }

  const message = JSON.stringify(valid);
  const sha256 = createHash('sha256').update(message).digest('hex');
  const key = 'erasure-ledger/v1/' + valid.requestId + '.json';

  try {
    // Quarantine must be durably enforced before attempting external IO.
    await operations.quarantineOwner(valid.userId);

    // If the external store times out after persisting, caller retries with
    // identical requestId and data. It must verify the previous immutable
    // object's full bytes (not merely trust an error response).
    const receiptResult = await operations.appendImmutableReceipt({
      key,
      body: message,
      sha256,
    });
    if (
      !receiptResult ||
      !['durable', 'verified-existing'].includes(receiptResult.status) ||
      receiptResult.sha256 !== sha256
    ) {
      throw new Error('Independent receipt was not durably verified');
    }

    // A DB failure after a successful external append leaves the independent
    // receipt available for reconciliation after restore. Never acknowledge.
    await operations.applyDatabaseFence(valid.userId, valid.requestedAt);
    return { status: 'accepted', deletionComplete: false };
  } catch {
    // Never emit a user ID, requestId, S3 key or provider exception. Do not
    // release a quarantine on failure or even on successful acceptance.
    throw new Error('VC Recap erasure receipt unavailable; keep access disabled');
  }
}
