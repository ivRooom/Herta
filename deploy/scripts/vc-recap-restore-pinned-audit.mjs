import { inspectVcRecapLedgerWithPinnedCheckpoint } from './vc-recap-erasure-signed-audit.mjs';
import { reconcileVcRecapRestoreUnderQuarantine } from './vc-recap-restore-quarantine.mjs';

const REQUIRED_OPERATIONS = [
  'requireDurableQuarantine',
  'loadSignedAudit',
  'loadAuditTrust',
  'loadPinnedCheckpoint',
  'replayErasureFences',
  'verifyDatabaseFences',
  'verifyAllCopiesPurged',
];

/**
 * Synthetic-only composition for #714 / #695.
 *
 * The restored database is never an audit authority. Quarantine must be durable
 * before even loading independent audit material. A separately trusted Ed25519
 * key, monotonic checkpoint and full S3 version inventory must match before an
 * erasure snapshot is passed to the injected, offline DB replay steps.
 *
 * The injected operations do NOT make their evidence durable or independent.
 * This module is NOT wired to any production process and NEVER lifts quarantine.
 * Real IAM, persistence, cross-service traffic gates and restore replay remain
 * unimplemented. Do not use this function to authorize production VC traffic.
 */
export async function reconcileVcRecapRestoreWithPinnedAudit(runId, dependencies) {
  if (
    !dependencies ||
    typeof dependencies !== 'object' ||
    REQUIRED_OPERATIONS.some((name) => typeof dependencies[name] !== 'function') ||
    !dependencies.ledgerClient ||
    typeof dependencies.ledgerClient.send !== 'function' ||
    !dependencies.ledgerCommands
  ) {
    throw new Error('VC Recap restore audit prerequisites unavailable');
  }

  let authenticatedSnapshot;

  return reconcileVcRecapRestoreUnderQuarantine(runId, {
    requireDurableQuarantine: (id) => dependencies.requireDurableQuarantine(id),
    loadIndependentLedger: (id) => dependencies.loadSignedAudit(id),
    authenticateLedger: async (id, envelope) => {
      // Neither trust nor checkpoint may be sourced from the restored database
      // or the audited S3 bucket. That provenance is an operator responsibility.
      const trust = await dependencies.loadAuditTrust(id);
      const checkpoint = await dependencies.loadPinnedCheckpoint(id);
      const checked = await inspectVcRecapLedgerWithPinnedCheckpoint(
        dependencies.ledgerClient,
        dependencies.ledgerCommands,
        envelope,
        trust,
        checkpoint,
      );
      if (
        checked.status !== 'pinned-checkpoint-local-match-only' ||
        checked.canResumeTraffic !== false ||
        !checked.snapshot ||
        !Array.isArray(checked.snapshot.entries) ||
        !Number.isSafeInteger(checked.objectCount) ||
        checked.objectCount !== envelope.payload.objectCount
      ) {
        throw new Error('VC Recap independent audit verification incomplete');
      }
      authenticatedSnapshot = checked.snapshot;
      return { runId: id, status: 'independently-authenticated' };
    },
    replayErasureFences: (id) =>
      dependencies.replayErasureFences(id, authenticatedSnapshot),
    verifyDatabaseFences: (id) =>
      dependencies.verifyDatabaseFences(id, authenticatedSnapshot),
    verifyAllCopiesPurged: (id) =>
      dependencies.verifyAllCopiesPurged(id, authenticatedSnapshot),
  });
}
