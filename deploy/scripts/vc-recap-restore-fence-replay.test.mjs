import assert from 'node:assert/strict';
import test from 'node:test';
import { EXTERNAL_SNAPSHOT_KIND } from './vc-recap-erasure-ledger-contract.mjs';
import { replayVcRecapRestoreFencesSynthetic } from './vc-recap-restore-fence-replay.mjs';

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_RUN = '00000000-0000-4000-8000-000000000002';
const A = '123456789012345678';
const B = '123456789012345679';
const NOW = Date.parse('2026-11-02T08:00:00Z');
const NEW = '2026-11-02T07:00:00Z';
const OLD = '2026-11-01T07:00:00Z';

function ledger(entries = [{ userId: A, requestedAt: NEW }]) {
  return {
    kind: EXTERNAL_SNAPSHOT_KIND,
    generatedAt: '2026-11-02T07:30:00Z',
    entries,
  };
}

function fixture() {
  const rows = new Map();
  const calls = [];
  const changes = { quarantine: true, failOwner: null, failStep: null, proof: null };
  const ops = {
    async requireDurableQuarantine(runId) {
      calls.push('quarantine');
      if (!changes.quarantine) return { runId: OTHER_RUN, status: 'quarantined' };
      return { runId, status: 'quarantined' };
    },
    async withOwnerTransaction(runId, userId, callback) {
      assert.equal(runId, RUN_ID);
      calls.push('lock:' + userId);
      if (changes.failOwner === userId) throw new Error('secret-owner-' + userId);
      const before = rows.get(userId);
      const state = before ? { ...before } : null;
      const tx = {
        async readFence() {
          calls.push('read:' + userId);
          return state ? { requestedAt: state.requestedAt } : null;
        },
        async upsertFenceAndRevoke(payload) {
          calls.push('write:' + userId);
          assert.equal(payload.userId, userId);
          assert.equal(payload.revokeLegacyConsent, true);
          assert.equal(payload.revokeAllPurposeConsents, true);
          assert.equal(payload.cancelPendingWrites, true);
          assert.equal(payload.storageDeletionVerifiedAt, null);
          if (changes.failStep === 'write') throw new Error('private key ' + userId);
          Object.assign(state ?? (tx.pending = {}), {
            requestedAt: payload.requestedAt,
            storageDeletionVerifiedAt: null,
            legacyConsentRevoked: true,
            purposeConsentsRevoked: true,
            pendingWritesCancelled: true,
          });
        },
        async verifyFenceAndRevocations() {
          calls.push('verify:' + userId);
          if (changes.failStep === 'verify') throw new Error('secret ' + userId);
          return changes.proof ?? { userId, ...(state ?? tx.pending) };
        },
      };
      await callback(tx);
      rows.set(userId, state ?? tx.pending);
      calls.push('commit:' + userId);
    },
  };
  return { rows, calls, changes, ops };
}

function replay(snapshot, ops) {
  return replayVcRecapRestoreFencesSynthetic(RUN_ID, snapshot, ops, { nowMillis: NOW });
}

test('quarantine precedes per-owner locked atomic replay; no traffic resume', async () => {
  const { rows, calls, ops } = fixture();
  const result = await replay(ledger([
    { userId: A, requestedAt: OLD },
    { userId: B, requestedAt: NEW },
  ]), ops);
  assert.deepEqual(result, {
    runId: RUN_ID,
    status: 'replayed-under-lock',
    ownersReplayed: 2,
    canResumeTraffic: false,
    canDeclareErased: false,
  });
  assert.deepEqual(calls, [
    'quarantine',
    'lock:' + A, 'read:' + A, 'write:' + A, 'verify:' + A, 'commit:' + A,
    'lock:' + B, 'read:' + B, 'write:' + B, 'verify:' + B, 'commit:' + B,
  ]);
  assert.equal(rows.get(A).storageDeletionVerifiedAt, null);
  assert.equal(rows.get(A).legacyConsentRevoked, true);
});

test('repeated replay does not move timestamps backwards or reauthorize deletion completion', async () => {
  const { rows, ops } = fixture();
  rows.set(A, {
    requestedAt: NEW,
    storageDeletionVerifiedAt: '2026-11-02T07:10:00Z',
    legacyConsentRevoked: false,
    purposeConsentsRevoked: false,
    pendingWritesCancelled: false,
  });
  await replay(ledger([{ userId: A, requestedAt: OLD }]), ops);
  await replay(ledger([{ userId: A, requestedAt: OLD }]), ops);
  assert.equal(rows.get(A).requestedAt, NEW);
  assert.equal(rows.get(A).storageDeletionVerifiedAt, null);
  assert.equal(rows.get(A).pendingWritesCancelled, true);
});

test('invalid snapshot is rejected before quarantine or any database operation', async () => {
  const broken = [
    null,
    {},
    ledger([]),
    { ...ledger(), entries: [{ userId: B, requestedAt: OLD }, { userId: A, requestedAt: NEW }] },
    ledger([{ userId: A, requestedAt: OLD }, { userId: A, requestedAt: NEW }]),
    ledger([{ userId: A, requestedAt: '2026-11-03T00:00:00Z' }]),
    ledger([{ userId: A, requestedAt: '2026-11-01T99:00:00Z' }]),
    ledger([{ userId: A, requestedAt: '2026-02-30T07:00:00Z' }]),
    ledger([{ userId: A, requestedAt: OLD, extra: true }]),
    ledger([{ userId: 'not-an-id', requestedAt: NEW }]),
    { ...ledger(), extra: true },
    { ...ledger(), generatedAt: '2026-11-03T07:30:00Z' },
  ];
  for (const snapshot of broken) {
    const { calls, ops } = fixture();
    await assert.rejects(replay(snapshot, ops), /quarantine must remain active/);
    assert.deepEqual(calls, []);
  }
});

test('invalid run, missing transaction adapter, or quarantine from another run refuses writes', async () => {
  const { calls, ops, changes } = fixture();
  await assert.rejects(
    replayVcRecapRestoreFencesSynthetic('not-a-run', ledger(), ops, { nowMillis: NOW }),
  );
  await assert.rejects(replay(ledger(), {}));
  assert.deepEqual(calls, []);
  changes.quarantine = false;
  await assert.rejects(replay(ledger(), ops));
  assert.deepEqual(calls, ['quarantine']);
});

test('failure on second owner rolls back its transaction and permits safe retry', async () => {
  const { rows, calls, ops, changes } = fixture();
  const snapshot = ledger([
    { userId: A, requestedAt: OLD },
    { userId: B, requestedAt: NEW },
  ]);
  changes.failOwner = B;
  await assert.rejects(replay(snapshot, ops), /quarantine must remain active/);
  assert.equal(rows.has(A), true);
  assert.equal(rows.has(B), false);
  assert.equal(calls.includes('commit:' + B), false);
  changes.failOwner = null;
  await replay(snapshot, ops);
  assert.equal(rows.has(B), true);
});

test('transaction failure or failed proof cannot commit any owner changes', async () => {
  for (const failure of ['write', 'verify']) {
    const { rows, calls, ops, changes } = fixture();
    changes.failStep = failure;
    await assert.rejects(replay(ledger(), ops));
    assert.equal(rows.has(A), false);
    assert.equal(calls.includes('commit:' + A), false);
  }
});

test('readback rejects stale fence, retained deletion-complete and missing consent revocation', async () => {
  for (const override of [
    { requestedAt: OLD },
    { storageDeletionVerifiedAt: NEW },
    { legacyConsentRevoked: false },
    { purposeConsentsRevoked: false },
    { pendingWritesCancelled: false },
    { userId: B },
  ]) {
    const { rows, ops, changes } = fixture();
    changes.proof = {
      userId: A,
      requestedAt: NEW,
      storageDeletionVerifiedAt: null,
      legacyConsentRevoked: true,
      purposeConsentsRevoked: true,
      pendingWritesCancelled: true,
      ...override,
    };
    await assert.rejects(replay(ledger(), ops));
    assert.equal(rows.has(A), false);
  }
});

test('database exceptions must not expose sensitive identifiers', async () => {
  const { ops, changes } = fixture();
  changes.failStep = 'write';
  await assert.rejects(replay(ledger(), ops), (error) => {
    assert.equal(error.message.includes(A), false);
    assert.equal(error.message.includes('private'), false);
    return true;
  });
});
