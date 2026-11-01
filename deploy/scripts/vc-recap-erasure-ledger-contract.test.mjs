import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleErasureSnapshot,
  validateErasureReceipt,
  ERASURE_EVENT_KIND,
  EXTERNAL_SNAPSHOT_KIND,
} from './vc-recap-erasure-ledger-contract.mjs';

const a = '123456789012345678';
const b = '123456789012345679';
const t1 = '2026-11-01T09:01:00Z';
const t2 = '2026-11-01T09:02:00Z';
const issued = '2026-11-01T09:03:00Z';
const event = (userId, requestId, requestedAt = t1) => ({
  kind: ERASURE_EVENT_KIND,
  requestId,
  userId,
  requestedAt,
});
const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const id3 = '00000000-0000-4000-8000-000000000003';

test('isolated immutable receipts produce deterministic latest-per-owner restore schema', () => {
  const inputs = [event(a, id1, t1), event(b, id2, t1), event(a, id3, t2)];
  const snapshot = assembleErasureSnapshot(inputs, {
    generatedAt: issued,
    independentlyAuditedCount: 3,
  });
  assert.deepEqual(snapshot, {
    kind: EXTERNAL_SNAPSHOT_KIND,
    generatedAt: issued,
    entries: [
      { userId: a, requestedAt: t2 },
      { userId: b, requestedAt: t1 },
    ],
  });
  assert.deepEqual(
    assembleErasureSnapshot([...inputs].reverse(), {
      generatedAt: issued,
      independentlyAuditedCount: 3,
    }),
    snapshot,
  );
});

test('reject missing or unaudited inventory, duplicates and future receipts', () => {
  const inputs = [event(a, id1), event(b, id2)];
  for (const options of [
    { generatedAt: issued },
    { generatedAt: issued, independentlyAuditedCount: 0 },
    { generatedAt: issued, independentlyAuditedCount: 3 },
    { generatedAt: issued, independentlyAuditedCount: NaN },
  ]) {
    assert.throws(() => assembleErasureSnapshot(inputs, options), /inventory/);
  }
  assert.throws(
    () =>
      assembleErasureSnapshot([event(a, id1), event(a, id1)], {
        generatedAt: issued,
        independentlyAuditedCount: 2,
      }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      assembleErasureSnapshot([event(a, id1, '2026-11-01T09:04:00Z')], {
        generatedAt: issued,
        independentlyAuditedCount: 1,
      }),
    /follows/,
  );
});

test('reject malformed schema, identifiers, calendar times, and unexpected personal-data fields', () => {
  for (const invalid of [
    { ...event(a, id1), userId: 'not-an-id' },
    { ...event(a, id1), kind: 'wrong-kind' },
    { ...event(a, id1), requestId: 'not-a-uuid' },
    { ...event(a, id1), transcript: 'must-not-appear' },
    { ...event(a, id1), requestedAt: '2026-02-30T09:01:00Z' },
    { ...event(a, id1), requestedAt: '2026-11-01T09:01:00+09:00' },
  ]) {
    assert.throws(() => validateErasureReceipt(invalid));
  }
});

test('failure errors never leak owner ID or object key', () => {
  const payload = { ...event(a, id1), objectKey: 'private-example-value' };
  assert.throws(
    () => validateErasureReceipt(payload),
    (e) => !e.message.includes(a) && !e.message.includes(payload.objectKey),
  );
});

test('empty ledger requires explicit independent zero-count, not implicit approval', () => {
  assert.deepEqual(
    assembleErasureSnapshot([], {
      generatedAt: issued,
      independentlyAuditedCount: 0,
    }),
    { kind: EXTERNAL_SNAPSHOT_KIND, generatedAt: issued, entries: [] },
  );
  // Downstream restore checker additionally requires explicit --allow-empty-ledger.
});
