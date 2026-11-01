import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { acceptVcRecapErasureWriteFirst } from './vc-recap-erasure-write-first.mjs';
import { ERASURE_EVENT_KIND } from './vc-recap-erasure-ledger-contract.mjs';

const userId = '123456789012345678';
const requestId = '00000000-0000-4000-8000-000000000001';
const requestedAt = '2026-11-01T09:01:00Z';
const receipt = { kind: ERASURE_EVENT_KIND, requestId, userId, requestedAt };

function makeOperations() {
  const calls = [];
  const operations = {
    quarantineOwner: async (id) => {
      calls.push(['quarantine', id]);
    },
    appendImmutableReceipt: async ({ key, body, sha256 }) => {
      calls.push(['ledger', key, body, sha256]);
      return { status: 'durable', sha256 };
    },
    applyDatabaseFence: async (id, time) => {
      calls.push(['fence', id, time]);
    },
  };
  return { calls, operations };
}

test('quarantine precedes immutable write, then DB fence, without claiming deletion', async () => {
  const { calls, operations } = makeOperations();
  const output = await acceptVcRecapErasureWriteFirst(receipt, operations);
  assert.deepEqual(output, { status: 'accepted', deletionComplete: false });
  assert.deepEqual(
    calls.map(([action]) => action),
    ['quarantine', 'ledger', 'fence'],
  );
  const [, key, body, sha256] = calls[1];
  assert.equal(key, 'erasure-ledger/v1/' + requestId + '.json');
  assert.equal(body, JSON.stringify(receipt));
  assert.equal(sha256, createHash('sha256').update(body).digest('hex'));
});

test('missing backend and malformed receipt cannot bypass quarantine', async () => {
  const { calls, operations } = makeOperations();
  await assert.rejects(
    acceptVcRecapErasureWriteFirst({ ...receipt, userId: 'not-an-owner' }, operations),
  );
  await assert.rejects(acceptVcRecapErasureWriteFirst(receipt, {}));
  assert.equal(calls.length, 0);
});

test('quarantine failure never writes externally or acknowledges a request', async () => {
  const { calls, operations } = makeOperations();
  operations.quarantineOwner = async () => {
    calls.push(['quarantine-failed']);
    throw new Error('confidential-user-id');
  };
  await assert.rejects(
    acceptVcRecapErasureWriteFirst(receipt, operations),
    (error) => !error.message.includes('confidential-user-id') && !error.message.includes(userId),
  );
  assert.deepEqual(
    calls.map(([action]) => action),
    ['quarantine-failed'],
  );
});

test('external append failure must not create a DB fence or acknowledge', async () => {
  const { calls, operations } = makeOperations();
  operations.appendImmutableReceipt = async () => {
    calls.push(['ledger-failed']);
    throw new Error('s3-private-bucket-name');
  };
  await assert.rejects(
    acceptVcRecapErasureWriteFirst(receipt, operations),
    (error) => !error.message.includes('s3-private-bucket-name'),
  );
  assert.deepEqual(
    calls.map(([action]) => action),
    ['quarantine', 'ledger-failed'],
  );
});

test('unverified conflict or hash mismatch is never accepted', async () => {
  for (const status of ['conflict', 'verified-existing']) {
    const { calls, operations } = makeOperations();
    operations.appendImmutableReceipt = async () => {
      calls.push(['ledger']);
      return { status, sha256: '0'.repeat(64) };
    };
    await assert.rejects(acceptVcRecapErasureWriteFirst(receipt, operations));
    assert.deepEqual(
      calls.map(([action]) => action),
      ['quarantine', 'ledger'],
    );
  }
});

test('durably verified retry is idempotent; DB failure leaves ledger receipt for replay', async () => {
  const { calls, operations } = makeOperations();
  operations.appendImmutableReceipt = async ({ sha256 }) => {
    calls.push(['verified-existing']);
    return { status: 'verified-existing', sha256 };
  };
  operations.applyDatabaseFence = async () => {
    calls.push(['fence-failed']);
    throw new Error('private-db-error');
  };
  await assert.rejects(
    acceptVcRecapErasureWriteFirst(receipt, operations),
    (error) => !error.message.includes('private-db-error'),
  );
  assert.deepEqual(
    calls.map(([action]) => action),
    ['quarantine', 'verified-existing', 'fence-failed'],
  );

  operations.applyDatabaseFence = async () => {
    calls.push(['fence-ok']);
  };
  const result = await acceptVcRecapErasureWriteFirst(receipt, operations);
  assert.deepEqual(result, { status: 'accepted', deletionComplete: false });
  assert.equal(calls.at(-1)[0], 'fence-ok');
});
