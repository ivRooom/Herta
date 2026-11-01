import { createHash, createPublicKey, verify } from 'node:crypto';
import { inspectVcRecapErasureLedgerVersions } from './vc-recap-erasure-s3-inventory.mjs';

export const SIGNED_AUDIT_KIND = 'vc-recap-independent-signed-inventory-v1';
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REQUIRED = [
  'auditId',
  'generatedAt',
  'kind',
  'ledgerBucket',
  'manifestSha256',
  'objectCount',
  'restoreRunId',
];

function normalizedPayload(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== REQUIRED.sort().join(',') ||
    input.kind !== SIGNED_AUDIT_KIND ||
    !UUID_V4.test(input.auditId) ||
    !UUID_V4.test(input.restoreRunId) ||
    typeof input.ledgerBucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.ledgerBucket) ||
    !Number.isSafeInteger(input.objectCount) ||
    input.objectCount < 0 ||
    input.objectCount > 100000 ||
    !SHA256.test(input.manifestSha256) ||
    typeof input.generatedAt !== 'string' ||
    !UTC.test(input.generatedAt)
  ) {
    throw new Error('Independent audit manifest schema is invalid');
  }
  const ms = Date.parse(input.generatedAt);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 19) !== input.generatedAt.slice(0, 19)
  ) {
    throw new Error('Independent audit timestamp is invalid');
  }
  return {
    kind: input.kind,
    auditId: input.auditId,
    restoreRunId: input.restoreRunId,
    ledgerBucket: input.ledgerBucket,
    generatedAt: input.generatedAt,
    objectCount: input.objectCount,
    manifestSha256: input.manifestSha256,
  };
}

/**
 * Authenticate an out-of-band audit statement with a separately trusted
 * Ed25519 verification key. The key fingerprint and key bytes MUST be
 * provisioned independently of the S3 ledger and restored PostgreSQL.
 *
 * Signature authentication alone cannot prove the auditor counted every
 * object, prevent a compromised signer, or supply an anti-rollback anchor.
 * This module neither grants serving access nor connects to production.
 */
export function verifySignedVcRecapAudit(envelope, trust) {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    Object.keys(envelope).sort().join(',') !== 'payload,signatureBase64' ||
    typeof envelope.signatureBase64 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signatureBase64) ||
    !trust ||
    typeof trust !== 'object' ||
    typeof trust.trustedPublicKeyPem !== 'string' ||
    !SHA256.test(trust.trustedPublicKeySha256) ||
    !UUID_V4.test(trust.restoreRunId) ||
    typeof trust.ledgerBucket !== 'string' ||
    !Number.isSafeInteger(trust.nowMillis) ||
    !Number.isSafeInteger(trust.maxAgeMillis) ||
    trust.maxAgeMillis < 1000 ||
    trust.maxAgeMillis > 86400000
  ) {
    throw new Error('Independent audit verification prerequisites missing');
  }

  try {
    const payload = normalizedPayload(envelope.payload);
    if (
      payload.restoreRunId !== trust.restoreRunId ||
      payload.ledgerBucket !== trust.ledgerBucket ||
      payload.ledgerBucket !== process.env['VC_RECAP_ERASURE_LEDGER_BUCKET']
    ) {
      throw new Error('Independent audit scope mismatch');
    }
    const issued = Date.parse(payload.generatedAt);
    if (issued > trust.nowMillis || trust.nowMillis - issued > trust.maxAgeMillis) {
      throw new Error('Independent audit freshness mismatch');
    }
    const key = createPublicKey(trust.trustedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Independent audit key type mismatch');
    }
    const fingerprint = createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (fingerprint !== trust.trustedPublicKeySha256) {
      throw new Error('Independent audit public key fingerprint mismatch');
    }
    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = Buffer.from(envelope.signatureBase64, 'base64');
    if (signature.length !== 64 || !verify(null, serialized, key, signature)) {
      throw new Error('Independent audit signature mismatch');
    }
    return {
      expectedCount: payload.objectCount,
      expectedManifestSha256: payload.manifestSha256,
      generatedAt: payload.generatedAt,
      canResumeTraffic: false,
      status: 'signed-audit-verified-only',
    };
  } catch {
    // Never leak identities, bucket names, manifest data or key material.
    throw new Error('Independent erasure audit cannot be authenticated');
  }
}

/**
 * Bridge an authenticated audit into the existing local inventory checker.
 * This still does NOT prove independent manifest completeness, durability,
 * currentness after the last signed timestamp, or permission to resume VC.
 */
export async function inspectVcRecapLedgerWithSignedAudit(
  client,
  commands,
  envelope,
  trust,
) {
  const audit = verifySignedVcRecapAudit(envelope, trust);
  const local = await inspectVcRecapErasureLedgerVersions(client, commands, {
    expectedCount: audit.expectedCount,
    expectedManifestSha256: audit.expectedManifestSha256,
    generatedAt: audit.generatedAt,
    allowEmpty: trust.allowEmpty === true,
    maxPages: trust.maxPages,
  });
  return { ...local, status: 'signed-audit-local-match-only', canResumeTraffic: false };
}
