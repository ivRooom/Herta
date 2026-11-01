import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileVcRecapRestoreUnderQuarantine } from './vc-recap-restore-quarantine.mjs';

const runId = '00000000-0000-4000-8000-000000000001';
const staleRunId = '00000000-0000-4000-8000-000000000002';
const sampleLedger = { kind: 'synthetic-external-ledger' };

function createOperations() {
  const calls = [];
  const operations = {
    requireDurableQuarantine: async (id) => {
      calls.push('quarantine');
      return { runId: id, status: 'quarantined' };
    },
    loadIndependentLedger: async () => {
      calls.push('load');
      return sampleLedger;
    },
    authenticateLedger: async (id) => {
      calls.push('authenticate');
      return { runId: id, status: 'independently-authenticated' };
    },
    replayErasureFences: async (id) => {
      calls.push('replay');
      return { runId: id, status: 'replayed-under-lock' };
    },
    verifyDatabaseFences: async (id) => {
      calls.push('db');
      return { runId: id, status: 'reconciled' };
    },
    verifyAllCopiesPurged: async (id) => {
      calls.push('copies');
      return { runId: id, status: 'verified-no-resurfacing' };
    },
  };
  return { calls, operations };
}

test('restore sequence always starts with durable quarantine and never unlocks traffic', async () => {
  const { calls, operations } = createOperations();
  const result = await reconcileVcRecapRestoreUnderQuarantine(runId, operations);
  assert.deepEqual(calls, ['quarantine', 'load', 'authenticate', 'replay', 'db', 'copies']);
  assert.deepEqual(result, {
    status: 'review-required',
    canResumeTraffic: false,
  });
});

test('a missing adapter, an invalid run id, or missing ledger fails before replay', async () => {
  const { calls, operations } = createOperations();
  await assert.rejects(reconcileVcRecapRestoreUnderQuarantine('bad-run-id', operations));
  await assert.rejects(reconcileVcRecapRestoreUnderQuarantine(runId, {}));
  assert.deepEqual(calls, []);

  operations.loadIndependentLedger = async () => {
    calls.push('missing-ledger');
    return null;
  };
  await assert.rejects(reconcileVcRecapRestoreUnderQuarantine(runId, operations));
  assert.deepEqual(calls, ['quarantine', 'missing-ledger']);
});

test('quarantine proof from another restore cannot authorize ledger reads', async () => {
  const { calls, operations } = createOperations();
  operations.requireDurableQuarantine = async () => {
    calls.push('quarantine');
    return { runId: staleRunId, status: 'quarantined' };
  };
  await assert.rejects(reconcileVcRecapRestoreUnderQuarantine(runId, operations));
  assert.deepEqual(calls, ['quarantine']);
});

test('every later step must supply a run-bound exact proof; never proceed after failure', async () => {
  const stages = [
    ['authenticateLedger', 'authenticate'],
    ['replayErasureFences', 'replay'],
    ['verifyDatabaseFences', 'db'],
    ['verifyAllCopiesPurged', 'copies'],
  ];
  for (const [name, call] of stages) {
    const { calls, operations } = createOperations();
    operations[name] = async () => {
      calls.push(call);
      return { runId: staleRunId, status: 'verified-no-resurfacing' };
    };
    await assert.rejects(reconcileVcRecapRestoreUnderQuarantine(runId, operations));
    assert.equal(calls.at(-1), call);
    assert.equal(calls.includes('unquarantine'), false);
    assert.equal(calls.includes('resume'), false);
  }
});

test('failed independent audit is never bypassed by a valid restored database', async () => {
  const { calls, operations } = createOperations();
  operations.authenticateLedger = async () => {
    calls.push('bad-audit');
    throw new Error('private-identifiers-and-storage-keys');
  };
  await assert.rejects(
    reconcileVcRecapRestoreUnderQuarantine(runId, operations),
    (error) => !error.message.includes('private-identifiers-and-storage-keys'),
  );
  assert.deepEqual(calls, ['quarantine', 'load', 'bad-audit']);
});

test('quarantine itself can fail and must not attempt any other step', async () => {
  const { calls, operations } = createOperations();
  operations.requireDurableQuarantine = async () => {
    calls.push('failed-to-freeze');
    throw new Error('unavailable');
  };
  await assert.rejects(reconcileVcRecapRestoreUnderQuarantine(runId, operations));
  assert.deepEqual(calls, ['failed-to-freeze']);
});
