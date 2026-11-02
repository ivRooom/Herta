import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ERASURE_EVENT_KIND } from './vc-recap-erasure-ledger-contract.mjs';
import {
  PINNED_AUDIT_CHECKPOINT_KIND,
  SIGNED_AUDIT_KIND,
} from './vc-recap-erasure-signed-audit.mjs';
import { reconcileVcRecapRestoreWithPinnedAudit } from './vc-recap-restore-pinned-audit.mjs';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const AUDIT_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const USER_ID = '123456789012345678'; // Synthetic fixture; never a real user.
const BUCKET = 'herta-restore-ledger-synthetic-test';
const GENERATED_AT = '2026-11-02T00:00:00Z';

function fixture() {
  const calls = [];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const receipt = {
    kind: ERASURE_EVENT_KIND,
    requestId: REQUEST_ID,
    userId: USER_ID,
    requestedAt: '2026-11-01T23:50:00Z',
  };
  const bytes = Buffer.from(JSON.stringify(receipt), 'utf8');
  const object = {
    Key: 'erasure-ledger/v1/' + REQUEST_ID + '.json',
    VersionId: 'synthetic-version-one',
    Size: bytes.length,
    IsLatest: true,
  };
  const manifest = [
    {
      key: object.Key,
      versionId: object.VersionId,
      receiptSha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ];
  const payload = {
    kind: SIGNED_AUDIT_KIND,
    auditId: AUDIT_ID,
    restoreRunId: RUN_ID,
    ledgerBucket: BUCKET,
    generatedAt: GENERATED_AT,
    objectCount: 1,
    manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  };
  const envelope = {
    payload,
    signatureBase64: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString(
      'base64',
    ),
  };
  const trust = {
    trustedPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    trustedPublicKeySha256: createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex'),
    restoreRunId: RUN_ID,
    ledgerBucket: BUCKET,
    nowMillis: Date.parse('2026-11-02T00:03:00Z'),
    maxAgeMillis: 15 * 60000,
  };
  const checkpoint = { ...payload, kind: PINNED_AUDIT_CHECKPOINT_KIND };
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
  const state = {
    quarantineStatus: 'quarantined',
    replayStatus: 'replayed-under-lock',
    databaseStatus: 'reconciled',
    copiesStatus: 'verified-no-resurfacing',
    object,
    bytes,
    envelope,
    trust,
    checkpoint,
  };
  const deps = {
    ledgerClient: {
      async send(command) {
        calls.push(command.kind);
        if (command.kind === 'list') {
          return { Versions: [state.object], IsTruncated: false };
        }
        if (command.kind === 'get') {
          return {
            $metadata: { httpStatusCode: 200 },
            VersionId: state.object.VersionId,
            ContentLength: state.bytes.length,
            Body: Readable.from([state.bytes]),
          };
        }
        throw new Error('unexpected mock command');
      },
    },
    ledgerCommands: commands,
    async requireDurableQuarantine(id) {
      calls.push('quarantine');
      return { runId: id, status: state.quarantineStatus };
    },
    async loadSignedAudit() {
      calls.push('load');
      return state.envelope;
    },
    async loadAuditTrust() {
      calls.push('trust');
      return state.trust;
    },
    async loadPinnedCheckpoint() {
      calls.push('checkpoint');
      return state.checkpoint;
    },
    async replayErasureFences(id, snapshot) {
      calls.push('replay');
      assert.deepEqual(snapshot.entries, [{ userId: USER_ID, requestedAt: receipt.requestedAt }]);
      return { runId: id, status: state.replayStatus };
    },
    async verifyDatabaseFences(id, snapshot) {
      calls.push('database');
      assert.equal(snapshot.entries.length, 1);
      return { runId: id, status: state.databaseStatus };
    },
    async verifyAllCopiesPurged(id, snapshot) {
      calls.push('copies');
      assert.equal(snapshot.entries.length, 1);
      return { runId: id, status: state.copiesStatus };
    },
  };
  return { calls, deps, state };
}

async function withBucket(fn) {
  const previous = process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
  process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = BUCKET;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'];
    else process.env['VC_RECAP_ERASURE_LEDGER_BUCKET'] = previous;
  }
}

test('quarantine precedes independent trust, inventory, offline replay and review-only result', async () => {
  await withBucket(async () => {
    const { calls, deps } = fixture();
    const result = await reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps);
    assert.deepEqual(calls, [
      'quarantine',
      'load',
      'trust',
      'checkpoint',
      'list',
      'get',
      'replay',
      'database',
      'copies',
    ]);
    assert.deepEqual(result, { status: 'review-required', canResumeTraffic: false });
  });
});

test('a failed durable quarantine blocks even the audit read', async () => {
  await withBucket(async () => {
    const { calls, deps, state } = fixture();
    state.quarantineStatus = 'pending';
    await assert.rejects(reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps));
    assert.deepEqual(calls, ['quarantine']);
  });
});

test('invalid signature, unpinned audit, another restore run and stale trust never replay', async () => {
  await withBucket(async () => {
    for (const variant of ['signature', 'checkpoint', 'run', 'stale']) {
      const { calls, deps, state } = fixture();
      if (variant === 'signature') state.envelope.signatureBase64 = 'a'.repeat(86) + '==';
      if (variant === 'checkpoint') state.checkpoint.objectCount = 2;
      if (variant === 'run') state.trust.restoreRunId = AUDIT_ID;
      if (variant === 'stale') state.trust.nowMillis += 86400000;
      await assert.rejects(
        reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps),
        (error) => !error.message.includes(BUCKET) && !error.message.includes(USER_ID),
      );
      assert.equal(calls.includes('replay'), false);
      assert.equal(calls.includes('list'), false);
    }
  });
});

test('full-version mismatch never permits database replay or serving', async () => {
  await withBucket(async () => {
    for (const variant of ['nonlatest', 'tampered', 'unexpected-version']) {
      const { calls, deps, state } = fixture();
      if (variant === 'nonlatest') state.object.IsLatest = false;
      if (variant === 'tampered') state.bytes = Buffer.from('private-identifier-' + USER_ID);
      if (variant === 'unexpected-version') {
        state.object.VersionId = 'untrusted-newer-version';
      }
      await assert.rejects(
        reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps),
        (error) => !error.message.includes(USER_ID),
      );
      assert.equal(calls.includes('list'), true);
      assert.equal(calls.includes('replay'), false);
    }
  });
});

test('failed replay, database proof, or copy purge always holds quarantine', async () => {
  await withBucket(async () => {
    for (const stage of ['replayStatus', 'databaseStatus', 'copiesStatus']) {
      const { calls, deps, state } = fixture();
      state[stage] = 'incomplete';
      await assert.rejects(reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps));
      assert.equal(calls.includes('copies'), stage === 'copiesStatus');
      assert.equal(calls.includes('resume'), false);
      assert.equal(calls.includes('unlock'), false);
    }
  });
});

test('missing dependency, invalid restore run, and private SDK errors fail closed', async () => {
  await withBucket(async () => {
    const { calls, deps } = fixture();
    await assert.rejects(reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, {}));
    await assert.rejects(reconcileVcRecapRestoreWithPinnedAudit('not-a-run', deps));
    assert.deepEqual(calls, []);
    deps.ledgerClient.send = async () => {
      calls.push('private-error');
      throw new Error('bucket-' + BUCKET + '-owner-' + USER_ID);
    };
    await assert.rejects(
      reconcileVcRecapRestoreWithPinnedAudit(RUN_ID, deps),
      (error) => !error.message.includes(USER_ID) && !error.message.includes(BUCKET),
    );
    assert.equal(calls.includes('replay'), false);
  });
});
