/**
 * Synthetic-only restore quarantine orchestration (#695).
 *
 * These injected operations are NOT wired into production. In particular,
 * verify* operations must authenticate independent ledger/sweep evidence;
 * a mock response or a restored DB row is never proof of completion.
 *
 * This function NEVER lifts quarantine or authorizes reopening VC traffic.
 */
const RESTORE_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireEvidence(proof, runId, expectedStatus) {
  if (
    !proof ||
    typeof proof !== 'object' ||
    proof.runId !== runId ||
    proof.status !== expectedStatus
  ) {
    throw new Error('Restore safety proof unavailable');
  }
}

/**
 * Return review-required only if the authenticated ledger was replayed under
 * quarantine and all deleted copies were independently checked. Never a Go.
 * Every operation must refer to the same exact restore execution identifier.
 */
export async function reconcileVcRecapRestoreUnderQuarantine(runId, operations) {
  const names = [
    'requireDurableQuarantine',
    'loadIndependentLedger',
    'authenticateLedger',
    'replayErasureFences',
    'verifyDatabaseFences',
    'verifyAllCopiesPurged',
  ];
  if (
    typeof runId !== 'string' ||
    !RESTORE_RUN_ID.test(runId) ||
    !operations ||
    names.some((name) => typeof operations[name] !== 'function')
  ) {
    throw new Error('Restore quarantine prerequisites unavailable');
  }

  try {
    const freeze = await operations.requireDurableQuarantine(runId);
    requireEvidence(freeze, runId, 'quarantined');

    const ledger = await operations.loadIndependentLedger(runId);
    if (!ledger || typeof ledger !== 'object') {
      throw new Error('Restore safety proof unavailable');
    }

    // The external adapter must independently authenticate origin, integrity,
    // freshness, and inventory count; the restored DB cannot be its authority.
    const authenticated = await operations.authenticateLedger(runId, ledger);
    requireEvidence(authenticated, runId, 'independently-authenticated');

    const replayed = await operations.replayErasureFences(runId, ledger);
    requireEvidence(replayed, runId, 'replayed-under-lock');

    const fences = await operations.verifyDatabaseFences(runId, ledger);
    requireEvidence(fences, runId, 'reconciled');

    const copies = await operations.verifyAllCopiesPurged(runId, ledger);
    requireEvidence(copies, runId, 'verified-no-resurfacing');

    // A separate operator/incident authority must evaluate the evidence and
    // intentionally unlock all routes. This code has no unlock operation.
    return { status: 'review-required', canResumeTraffic: false };
  } catch {
    // Never expose Discord IDs, object keys, database/SDK errors or manifests.
    // Crucially, DO NOT invoke any unquarantine method after a partial failure.
    throw new Error('VC Recap restore is not verified; keep all traffic disabled');
  }
}
