import { EXTERNAL_SNAPSHOT_KIND } from './vc-recap-erasure-ledger-contract.mjs';

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNER_ID = /^[0-9]{15,22}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MAX_OWNERS = 100000;

function timestamp(value) {
  if (typeof value !== 'string' || !UTC.test(value)) throw new Error('Invalid timestamp');
  const ms = Date.parse(value);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error('Invalid calendar date');
  }
  return ms;
}

function exactKeys(value, names) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...names].sort().join(',')
  );
}

/**
 * Offline-only validation. A signed, independently pinned and complete ledger
 * must be authenticated BEFORE this function is ever called by a restore flow.
 * Empty ledgers are intentionally rejected until a separate zero-count proof
 * is implemented. This check alone does not authenticate source/provenance.
 */
function verifySnapshot(snapshot, nowMillis) {
  if (
    !exactKeys(snapshot, ['kind', 'generatedAt', 'entries']) ||
    snapshot.kind !== EXTERNAL_SNAPSHOT_KIND ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length < 1 ||
    snapshot.entries.length > MAX_OWNERS ||
    !Number.isFinite(nowMillis)
  ) {
    throw new Error('Restore snapshot unavailable');
  }
  const generatedAt = timestamp(snapshot.generatedAt);
  if (generatedAt > nowMillis) throw new Error('Snapshot from the future');
  let previous = '';
  for (const entry of snapshot.entries) {
    if (
      !exactKeys(entry, ['userId', 'requestedAt']) ||
      typeof entry.userId !== 'string' ||
      !OWNER_ID.test(entry.userId) ||
      entry.userId <= previous
    ) {
      throw new Error('Invalid or unsorted owner entries');
    }
    const requestedAt = timestamp(entry.requestedAt);
    if (requestedAt > generatedAt) throw new Error('Future erasure request');
    previous = entry.userId;
  }
}

/**
 * Synthetic-only #695 / #724 replay contract; NO production callers/DB client.
 * withOwnerTransaction MUST acquire a per-owner advisory lock, execute every
 * callback operation inside ONE database transaction and resolve only after
 * commit. The restored DB is never a source of independent ledger authority.
 *
 * The caller must maintain a durable, cross-service read/write quarantine.
 * Even full success NEVER resumes traffic or declares all copies erased.
 */
export async function replayVcRecapRestoreFencesSynthetic(
  runId,
  snapshot,
  operations,
  { nowMillis = Date.now() } = {},
) {
  try {
    if (
      typeof runId !== 'string' ||
      !UUID_V4.test(runId) ||
      !operations ||
      typeof operations.requireDurableQuarantine !== 'function' ||
      typeof operations.withOwnerTransaction !== 'function'
    ) {
      throw new Error('Missing replay dependencies');
    }
    verifySnapshot(snapshot, nowMillis);

    const quarantine = await operations.requireDurableQuarantine(runId);
    if (
      !exactKeys(quarantine, ['runId', 'status']) ||
      quarantine.runId !== runId ||
      quarantine.status !== 'quarantined'
    ) {
      throw new Error('Restore is not quarantined');
    }

    for (const entry of snapshot.entries) {
      await operations.withOwnerTransaction(runId, entry.userId, async (tx) => {
        if (
          !tx ||
          typeof tx.readFence !== 'function' ||
          typeof tx.upsertFenceAndRevoke !== 'function' ||
          typeof tx.verifyFenceAndRevocations !== 'function'
        ) {
          throw new Error('Owner transaction is incomplete');
        }
        const existing = await tx.readFence();
        if (
          existing !== null &&
          !exactKeys(existing, ['requestedAt'])
        ) {
          throw new Error('Existing fence is invalid');
        }
        const oldMillis = existing === null ? -Infinity : timestamp(existing.requestedAt);
        const latest = oldMillis > timestamp(entry.requestedAt)
          ? existing.requestedAt
          : entry.requestedAt;

        await tx.upsertFenceAndRevoke({
          userId: entry.userId,
          requestedAt: latest,
          // A restore must never preserve an unverified 'deletion complete'.
          storageDeletionVerifiedAt: null,
          revokeLegacyConsent: true,
          revokeAllPurposeConsents: true,
          cancelPendingWrites: true,
        });

        const proof = await tx.verifyFenceAndRevocations();
        if (
          !exactKeys(proof, [
            'userId',
            'requestedAt',
            'storageDeletionVerifiedAt',
            'legacyConsentRevoked',
            'purposeConsentsRevoked',
            'pendingWritesCancelled',
          ]) ||
          proof.userId !== entry.userId ||
          timestamp(proof.requestedAt) < timestamp(latest) ||
          proof.storageDeletionVerifiedAt !== null ||
          proof.legacyConsentRevoked !== true ||
          proof.purposeConsentsRevoked !== true ||
          proof.pendingWritesCancelled !== true
        ) {
          throw new Error('Database fence verification failed');
        }
      });
    }

    return {
      runId,
      status: 'replayed-under-lock',
      ownersReplayed: snapshot.entries.length,
      canResumeTraffic: false,
      canDeclareErased: false,
    };
  } catch {
    // Do not leak Discord user IDs, timestamps, keys or database exceptions.
    throw new Error('VC Recap restore replay unverified; quarantine must remain active');
  }
}
