import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VC_RECAP_TRAFFIC_ROUTES,
  evaluateVcRecapRestoreTrafficGate,
} from './vc-recap-restore-traffic-gate.mjs';

const runId = '00000000-0000-4000-8000-000000000001';
const otherRunId = '00000000-0000-4000-8000-000000000002';
const nowMillis = Date.parse('2026-11-02T09:00:00.000Z');
const DENIED = { decision: 'deny', canResumeTraffic: false };
const REVIEW = { decision: 'operator-review-required', canResumeTraffic: false };
const request = { route: 'studio.export', restoreRunId: runId, nowMillis };

function makeAdapters(overrides = {}) {
  const calls = [];
  const control = {
    kind: 'vc-recap-restore-quarantine-control-v1',
    scope: 'vc-recap/all-routes',
    restoreRunId: runId,
    epoch: 23,
    status: 'review-pending',
    issuedAt: '2026-11-02T08:59:00.000Z',
    expiresAt: '2026-11-02T09:03:00.000Z',
    clearance: {
      ledgerAuthenticated: true,
      ownerFencesReplayed: true,
      allCopiesVerified: true,
      operatorApproved: true,
    },
  };
  const authority = {
    loadIndependentControl: async () => {
      calls.push('load-control');
      return control;
    },
    authenticateIndependentControl: async () => {
      calls.push('verify-control');
      return { restoreRunId: runId, epoch: 23, status: 'independently-authenticated' };
    },
    loadPinnedEpoch: async () => {
      calls.push('load-epoch');
      return { restoreRunId: runId, epoch: 23 };
    },
    authenticatePinnedEpoch: async () => {
      calls.push('verify-epoch');
      return { restoreRunId: runId, epoch: 23, status: 'independently-pinned' };
    },
    ...overrides,
  };
  return { control, authority, calls };
}

test('route inventory includes every currently known read/write/consumer boundary', () => {
  assert.equal(VC_RECAP_TRAFFIC_ROUTES.length, 16);
  assert.equal(new Set(VC_RECAP_TRAFFIC_ROUTES).size, VC_RECAP_TRAFFIC_ROUTES.length);
  for (const route of VC_RECAP_TRAFFIC_ROUTES) {
    assert.equal(typeof route, 'string');
  }
});

test('missing, invalid route, invalid run and unavailable authority deny before touching adapters', async () => {
  const { authority, calls } = makeAdapters();
  assert.deepEqual(await evaluateVcRecapRestoreTrafficGate({}, authority), DENIED);
  assert.deepEqual(await evaluateVcRecapRestoreTrafficGate(request, {}), DENIED);
  assert.deepEqual(
    await evaluateVcRecapRestoreTrafficGate({ ...request, route: 'unknown' }, authority),
    DENIED,
  );
  assert.deepEqual(
    await evaluateVcRecapRestoreTrafficGate({ ...request, restoreRunId: 'x' }, authority),
    DENIED,
  );
  assert.deepEqual(calls, []);
});

test('an independently attested and pinned review state still NEVER grants traffic', async () => {
  for (const route of VC_RECAP_TRAFFIC_ROUTES) {
    const { authority, calls } = makeAdapters();
    assert.deepEqual(
      await evaluateVcRecapRestoreTrafficGate({ ...request, route }, authority),
      REVIEW,
    );
    assert.deepEqual(calls, ['load-control', 'verify-control', 'load-epoch', 'verify-epoch']);
  }
});

test('quarantine and restore-pending deny every route regardless of clearance', async () => {
  for (const status of ['quarantined', 'restore-pending']) {
    const { control, authority, calls } = makeAdapters();
    control.status = status;
    for (const route of VC_RECAP_TRAFFIC_ROUTES) {
      assert.deepEqual(
        await evaluateVcRecapRestoreTrafficGate({ ...request, route }, authority),
        DENIED,
      );
    }
    assert.equal(calls.includes('verify-epoch'), true);
  }
});

test('partial evidence or an unverified operator vetoes review', async () => {
  for (const key of [
    'ledgerAuthenticated',
    'ownerFencesReplayed',
    'allCopiesVerified',
    'operatorApproved',
  ]) {
    const { control, authority } = makeAdapters();
    control.clearance[key] = false;
    assert.deepEqual(await evaluateVcRecapRestoreTrafficGate(request, authority), DENIED);
  }
});

test('stale, future, expired, extended TTL and invalid calendar date deny', async () => {
  const values = [
    { expiresAt: '2026-11-02T08:59:59.999Z' },
    { issuedAt: '2026-11-02T09:00:00.001Z' },
    { issuedAt: '2026-11-02T08:54:00.000Z' },
    { expiresAt: '2026-11-02T09:07:00.000Z' },
    { issuedAt: '2026-11-02T08:99:00.000Z' },
    { expiresAt: '2026-11-02T09:00:00.000Z' },
  ];
  for (const replacement of values) {
    const { control, authority } = makeAdapters();
    Object.assign(control, replacement);
    assert.deepEqual(await evaluateVcRecapRestoreTrafficGate(request, authority), DENIED);
  }
});

test('invalid schema, unknown status, bad epoch and wrong restore run deny', async () => {
  const values = [
    { scope: 'global' },
    { restoreRunId: otherRunId },
    { epoch: 0 },
    { epoch: 24 },
    { epoch: 23.1 },
    { status: 'released' },
    { clearance: { allCopiesVerified: true } },
    { unexpected: 'extra' },
  ];
  for (const replacement of values) {
    const { control, authority } = makeAdapters();
    Object.assign(control, replacement);
    assert.deepEqual(await evaluateVcRecapRestoreTrafficGate(request, authority), DENIED);
  }
});

test('stale attestation, rollback checkpoint and fake pin are all denied', async () => {
  const scenarios = [
    {
      authenticateIndependentControl: async () => ({
        restoreRunId: otherRunId,
        epoch: 23,
        status: 'independently-authenticated',
      }),
    },
    { authenticateIndependentControl: async () => ({ status: 'ok' }) },
    { loadPinnedEpoch: async () => ({ restoreRunId: runId, epoch: 24 }) },
    { loadPinnedEpoch: async () => ({ restoreRunId: otherRunId, epoch: 23 }) },
    {
      authenticatePinnedEpoch: async () => ({
        restoreRunId: runId,
        epoch: 22,
        status: 'independently-pinned',
      }),
    },
    {
      authenticatePinnedEpoch: async () => ({
        restoreRunId: runId,
        epoch: 23,
        status: 'unverified',
      }),
    },
  ];
  for (const overrides of scenarios) {
    const { authority } = makeAdapters(overrides);
    assert.deepEqual(await evaluateVcRecapRestoreTrafficGate(request, authority), DENIED);
  }
});

test('failure is sanitized without exposing secrets or setting an allow flag', async () => {
  for (const operation of [
    'loadIndependentControl',
    'authenticateIndependentControl',
    'loadPinnedEpoch',
    'authenticatePinnedEpoch',
  ]) {
    const { authority } = makeAdapters();
    authority[operation] = async () => {
      throw new Error('private-user-id-and-s3-keys');
    };
    const result = await evaluateVcRecapRestoreTrafficGate(request, authority);
    assert.deepEqual(result, DENIED);
    assert.equal(JSON.stringify(result).includes('private-user-id'), false);
  }
});
