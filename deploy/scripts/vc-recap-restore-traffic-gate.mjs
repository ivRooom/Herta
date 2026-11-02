/**
 * #731 / #728: Offline-only cross-service VC Recap restore traffic gate contract.
 *
 * This module NEVER authorizes traffic. It does not read a real independent
 * control plane, establish durable quarantine, or wire Bot/Studio/API/Worker.
 * Missing or unauthenticated evidence always denies access.
 */
export const VC_RECAP_TRAFFIC_ROUTES = Object.freeze([
  'bot.start',
  'bot.stop',
  'bot.list',
  'bot.transcript-write',
  'bot.summary-write',
  'studio.list',
  'studio.detail',
  'studio.consent',
  'studio.export',
  'api.transcript-read',
  'worker.retention',
  'worker.erasure',
  'storage.archive',
  'storage.audio',
  'storage.signed-url',
  'cache.read-write',
]);

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const KIND = 'vc-recap-restore-quarantine-control-v1';
const SCOPE = 'vc-recap/all-routes';
const MAX_TTL_MS = 300_000;
const DENIED = Object.freeze({ decision: 'deny', canResumeTraffic: false });
const REVIEW = Object.freeze({
  decision: 'operator-review-required',
  canResumeTraffic: false,
});

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function timeMillis(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  if (new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return millis;
}

function signedControlIsWellFormed(control, runId, nowMillis) {
  if (
    !exactKeys(control, [
      'kind',
      'scope',
      'restoreRunId',
      'epoch',
      'status',
      'issuedAt',
      'expiresAt',
      'clearance',
    ]) ||
    control.kind !== KIND ||
    control.scope !== SCOPE ||
    control.restoreRunId !== runId ||
    !Number.isSafeInteger(control.epoch) ||
    control.epoch < 1 ||
    !['quarantined', 'restore-pending', 'review-pending'].includes(control.status) ||
    !exactKeys(control.clearance, [
      'ledgerAuthenticated',
      'ownerFencesReplayed',
      'allCopiesVerified',
      'operatorApproved',
    ]) ||
    Object.values(control.clearance).some((item) => typeof item !== 'boolean')
  ) {
    return false;
  }
  const issued = timeMillis(control.issuedAt);
  const expires = timeMillis(control.expiresAt);
  return (
    issued !== null &&
    expires !== null &&
    issued <= nowMillis &&
    expires > nowMillis &&
    issued < expires &&
    expires - issued <= MAX_TTL_MS
  );
}

/**
 * Evaluate one route using ONLY independently verified, run-bound evidence.
 *
 * All injected adapters are currently mocks/contracts, not a production
 * authority. They must later verify signatures and anti-rollback checkpoints
 * against an independently provisioned trust anchor, not the restored DB.
 * In particular, the returned REVIEW state is NOT access permission.
 *
 * No fail-open fallback, network/DB calls, or unlock side effects are allowed.
 */
export async function evaluateVcRecapRestoreTrafficGate(request, authority) {
  if (
    !exactKeys(request, ['route', 'restoreRunId', 'nowMillis']) ||
    !VC_RECAP_TRAFFIC_ROUTES.includes(request.route) ||
    typeof request.restoreRunId !== 'string' ||
    !RUN_ID.test(request.restoreRunId) ||
    !Number.isSafeInteger(request.nowMillis) ||
    !authority ||
    typeof authority.loadIndependentControl !== 'function' ||
    typeof authority.authenticateIndependentControl !== 'function' ||
    typeof authority.loadPinnedEpoch !== 'function' ||
    typeof authority.authenticatePinnedEpoch !== 'function'
  ) {
    return DENIED;
  }

  try {
    const control = await authority.loadIndependentControl(request.restoreRunId);
    if (!signedControlIsWellFormed(control, request.restoreRunId, request.nowMillis)) {
      return DENIED;
    }

    const attested = await authority.authenticateIndependentControl(control);
    if (
      !exactKeys(attested, ['restoreRunId', 'epoch', 'status']) ||
      attested.restoreRunId !== request.restoreRunId ||
      attested.epoch !== control.epoch ||
      attested.status !== 'independently-authenticated'
    ) {
      return DENIED;
    }

    const pinned = await authority.loadPinnedEpoch(request.restoreRunId);
    if (
      !exactKeys(pinned, ['restoreRunId', 'epoch']) ||
      pinned.restoreRunId !== request.restoreRunId ||
      !Number.isSafeInteger(pinned.epoch) ||
      pinned.epoch !== control.epoch
    ) {
      return DENIED;
    }

    const checkpoint = await authority.authenticatePinnedEpoch(pinned);
    if (
      !exactKeys(checkpoint, ['restoreRunId', 'epoch', 'status']) ||
      checkpoint.restoreRunId !== request.restoreRunId ||
      checkpoint.epoch !== control.epoch ||
      checkpoint.status !== 'independently-pinned'
    ) {
      return DENIED;
    }

    if (
      control.status !== 'review-pending' ||
      Object.values(control.clearance).some((item) => item !== true)
    ) {
      return DENIED;
    }

    // This is not 'allow': the operator must separately authorize reopening
    // every route after a real, independently verified disaster-recovery run.
    return REVIEW;
  } catch {
    // Never log raw errors, restore keys, object names, or personal identifiers.
    return DENIED;
  }
}
