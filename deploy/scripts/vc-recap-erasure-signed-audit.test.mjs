import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ERASURE_EVENT_KIND } from './vc-recap-erasure-ledger-contract.mjs';
import {
  PINNED_AUDIT_CHECKPOINT_KIND,
  SIGNED_AUDIT_KIND,
  inspectVcRecapLedgerWithPinnedCheckpoint,
  inspectVcRecapLedgerWithSignedAudit,
  verifyPinnedVcRecapAudit,
  verifySignedVcRecapAudit,
} from './vc-recap-erasure-signed-audit.mjs';

const BUCKET = 'herta-standalone-audit-ledger-test';
const RESTORE_RUN = '00000000-0000-4000-8000-000000000001';
const AUDIT_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const PREFIX = 'erasure-ledger/v1/';
const generatedAt = '2026-11-02T00:00:00Z';
const nowMillis = Date.parse('2026-11-02T00:03:00Z');
const entry = {
  kind: ERASURE_EVENT_KIND,
  requestId: REQUEST_ID,
  userId: '123456789012345678',
  requestedAt: '2026-11-01T23:55:00Z',
};
const bytes = Buffer.from(JSON.stringify(entry));
const version = {
  Key: PREFIX + REQUEST_ID + '.json',
  VersionId: 'one-version',
  Size: bytes.length,
  IsLatest: true,
};
const manifest = [
  {
    key: version.Key,
    versionId: version.VersionId,
    receiptSha256: createHash('sha256').update(bytes).digest('hex'),
  },
];
const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');

const payload = () => ({
  kind: SIGNED_AUDIT_KIND,
  auditId: AUDIT_ID,
  restoreRunId: RESTORE_RUN,
  ledgerBucket: BUCKET,
  generatedAt,
  objectCount: 1,
  manifestSha256,
});
const envelope = (value = payload(), signingKey = privateKey) => ({
  payload: value,
  signatureBase64: sign(null, Buffer.from(JSON.stringify(value)), signingKey).toString('base64'),
});
const trust = (changes = {}) => ({
  trustedPublicKeyPem: pem,
  trustedPublicKeySha256: fingerprint,
  restoreRunId: RESTORE_RUN,
  ledgerBucket: BUCKET,
  nowMillis,
  maxAgeMillis: 15 * 60000,
  ...changes,
});

async function withBucket(run) {
  const previous = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = BUCKET;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
    else process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = previous;
  }
}

const commands = {
  ListObjectVersionsCommand: class {
    constructor(input) {
      this.kind = 'list';
      this.input = input;
    }
  },
  GetObjectCommand: class {
    constructor(input) {
      this.kind = 'get';
      this.input = input;
    }
  },
};

test('pinned Ed25519 audit is authenticated and cannot authorize VC traffic', async () => {
  await withBucket(() => {
    const result = verifySignedVcRecapAudit(envelope(), trust());
    assert.deepEqual(result, {
      expectedCount: 1,
      expectedManifestSha256: manifestSha256,
      generatedAt,
      canResumeTraffic: false,
      status: 'signed-audit-verified-only',
    });
  });
});

test('signed audit drives actual version-scoped local listing and GET (mock only)', async () => {
  await withBucket(async () => {
    const calls = [];
    const client = {
      async send(cmd) {
        calls.push(cmd);
        if (cmd.kind === 'list') {
          return { Versions: [version], IsTruncated: false };
        }
        return {
          $metadata: { httpStatusCode: 200 },
          ContentLength: bytes.length,
          VersionId: version.VersionId,
          Body: Readable.from([bytes]),
        };
      },
    };
    const checked = await inspectVcRecapLedgerWithSignedAudit(
      client,
      commands,
      envelope(),
      trust(),
    );
    assert.equal(checked.status, 'signed-audit-local-match-only');
    assert.equal(checked.canResumeTraffic, false);
    assert.equal(checked.objectCount, 1);
    assert.equal(checked.manifestSha256, manifestSha256);
    assert.deepEqual(checked.snapshot.entries, [
      { userId: entry.userId, requestedAt: entry.requestedAt },
    ]);
    assert.equal(calls[0].kind, 'list');
    assert.equal(calls[1].kind, 'get');
    assert.equal(calls[1].input.VersionId, 'one-version');
  });
});

test('wrong public key, fingerprint, and corrupted signature all fail closed', async () => {
  await withBucket(() => {
    const other = generateKeyPairSync('ed25519');
    const invalid = [
      [
        envelope(),
        trust({ trustedPublicKeyPem: other.publicKey.export({ type: 'spki', format: 'pem' }) }),
      ],
      [envelope(), trust({ trustedPublicKeySha256: '0'.repeat(64) })],
      [envelope(payload(), other.privateKey), trust()],
      [{ ...envelope(), signatureBase64: 'a'.repeat(86) + '==' }, trust()],
    ];
    for (const [signed, settings] of invalid) {
      assert.throws(() => verifySignedVcRecapAudit(signed, settings), /audit/);
    }
  });
});

test('expired, future, mismatched run/bucket, malformed and altered signed content fail', async () => {
  await withBucket(() => {
    const original = envelope();
    const invalid = [
      [original, trust({ nowMillis: Date.parse('2026-11-02T01:00:00Z') })],
      [original, trust({ nowMillis: Date.parse('2026-11-01T23:59:59Z') })],
      [original, trust({ restoreRunId: AUDIT_ID })],
      [original, trust({ ledgerBucket: 'another-audit-ledger-bucket' })],
      [{ ...original, payload: { ...original.payload, objectCount: 2 } }, trust()],
      [envelope({ ...payload(), generatedAt: '2026-02-30T00:00:00Z' }), trust()],
      [envelope({ ...payload(), extra: 'not allowed' }), trust()],
      [envelope({ ...payload(), objectCount: -1 }), trust()],
      [envelope({ ...payload(), manifestSha256: 'invalid' }), trust()],
    ];
    for (const [signed, settings] of invalid) {
      assert.throws(() => verifySignedVcRecapAudit(signed, settings));
    }
  });
});

test('signed counts or digests that do not match inventory do not pass local verification', async () => {
  await withBucket(async () => {
    const spy = { calls: 0 };
    const client = {
      async send(cmd) {
        spy.calls++;
        if (cmd.kind === 'list') return { Versions: [version], IsTruncated: false };
        return {
          $metadata: { httpStatusCode: 200 },
          ContentLength: bytes.length,
          VersionId: version.VersionId,
          Body: Readable.from([bytes]),
        };
      },
    };
    for (const badPayload of [
      { ...payload(), objectCount: 2 },
      { ...payload(), manifestSha256: '0'.repeat(64) },
    ]) {
      await assert.rejects(
        inspectVcRecapLedgerWithSignedAudit(client, commands, envelope(badPayload), trust()),
      );
    }
    assert.ok(spy.calls > 0);
  });
});

test('missing trust prevents any S3 listing and hides confidential audit details in errors', async () => {
  await withBucket(async () => {
    let calls = 0;
    const client = {
      async send() {
        calls++;
        return {};
      },
    };
    await assert.rejects(
      inspectVcRecapLedgerWithSignedAudit(
        client,
        commands,
        envelope(),
        trust({
          trustedPublicKeyPem: 'private-sentinel-name',
        }),
      ),
      (error) => !error.message.includes('private-sentinel-name'),
    );
    assert.equal(calls, 0);
  });
});

const checkpoint = (changes = {}) => ({
  ...payload(),
  kind: PINNED_AUDIT_CHECKPOINT_KIND,
  ...changes,
});

test('out-of-band checkpoint pin matches exact signed inventory without resuming traffic', async () => {
  await withBucket(async () => {
    const verified = verifyPinnedVcRecapAudit(envelope(), trust(), checkpoint());
    assert.equal(verified.status, 'signed-audit-checkpoint-matched-only');
    assert.equal(verified.canResumeTraffic, false);
    const calls = [];
    const client = {
      async send(cmd) {
        calls.push(cmd.kind);
        if (cmd.kind === 'list') return { Versions: [version], IsTruncated: false };
        return {
          $metadata: { httpStatusCode: 200 },
          ContentLength: bytes.length,
          VersionId: version.VersionId,
          Body: Readable.from([bytes]),
        };
      },
    };
    const checked = await inspectVcRecapLedgerWithPinnedCheckpoint(
      client,
      commands,
      envelope(),
      trust(),
      checkpoint(),
    );
    assert.equal(checked.status, 'pinned-checkpoint-local-match-only');
    assert.equal(checked.canResumeTraffic, false);
    assert.deepEqual(calls, ['list', 'get']);
  });
});

test('previously valid signed audit cannot be replayed against a newly pinned checkpoint', async () => {
  await withBucket(async () => {
    const prior = envelope();
    const newer = checkpoint({
      auditId: '00000000-0000-4000-8000-000000000004',
      generatedAt: '2026-11-02T00:01:00Z',
    });
    assert.throws(() => verifyPinnedVcRecapAudit(prior, trust(), newer), /checkpoint/);
    let calls = 0;
    await assert.rejects(
      inspectVcRecapLedgerWithPinnedCheckpoint(
        { async send() { calls++; return {}; } },
        commands,
        prior,
        trust(),
        newer,
      ),
      /checkpoint/,
    );
    assert.equal(calls, 0);
  });
});

test('missing, malformed, and independently mismatched checkpoint pins fail closed', async () => {
  await withBucket(async () => {
    const invalid = [
      undefined,
      null,
      {},
      { ...checkpoint(), extra: 'untrusted' },
      checkpoint({ kind: 'untrusted' }),
      checkpoint({ auditId: '00000000-0000-4000-8000-000000000004' }),
      checkpoint({ restoreRunId: AUDIT_ID }),
      checkpoint({ ledgerBucket: 'another-audit-bucket' }),
      checkpoint({ generatedAt: '2026-11-01T23:59:59Z' }),
      checkpoint({ objectCount: 2 }),
      checkpoint({ manifestSha256: '0'.repeat(64) }),
    ];
    let calls = 0;
    const client = { async send() { calls++; return {}; } };
    for (const pin of invalid) {
      await assert.rejects(
        inspectVcRecapLedgerWithPinnedCheckpoint(client, commands, envelope(), trust(), pin),
      );
    }
    assert.equal(calls, 0);
  });
});

test('pin does not bypass signature authentication and never includes private details in errors', async () => {
  await withBucket(async () => {
    let calls = 0;
    const client = { async send() { calls++; return {}; } };
    const falsified = { ...envelope(), signatureBase64: 'a'.repeat(86) + '==' };
    await assert.rejects(
      inspectVcRecapLedgerWithPinnedCheckpoint(
        client,
        commands,
        falsified,
        trust(),
        checkpoint(),
      ),
      (error) => !error.message.includes(BUCKET) && !error.message.includes(entry.userId),
    );
    assert.equal(calls, 0);
  });
});
