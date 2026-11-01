import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeCompare,
  determineGateOutcome,
  needsPostgresIntegration,
  validateDeployRef,
} from './production-quality-gate.mjs';

const sha = 'a'.repeat(40);
const baseline = {
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  run_attempt: 1,
  created_at: '2026-11-01T10:00:00Z',
  status: 'completed',
  conclusion: 'success',
};

test('production gate needs real PostgreSQL integration for DB, Bot and Studio changes', () => {
  for (const path of [
    'packages/db/src/vc-recap-explicit-consent.ts',
    'apps/bot/src/voice/voice.ts',
    'apps/studio/src/page.tsx',
    '.github/workflows/valorant-agents.yml',
  ]) {
    assert.equal(needsPostgresIntegration([path]), true, path);
  }
  assert.equal(needsPostgresIntegration(['docs/VC_RECAP_RELEASE_HANDOFF.md']), false);
  assert.equal(needsPostgresIntegration(['deploy/scripts/x.sh']), false);
});

test('checks accept only exact commit, main push, and successful completion', () => {
  assert.equal(determineGateOutcome([baseline], sha), 'success');
  assert.equal(determineGateOutcome([{ ...baseline, head_sha: 'b'.repeat(40) }], sha), 'pending');
  assert.equal(determineGateOutcome([{ ...baseline, head_branch: 'feature' }], sha), 'pending');
  assert.equal(determineGateOutcome([{ ...baseline, event: 'pull_request' }], sha), 'pending');
  assert.equal(
    determineGateOutcome([{ ...baseline, status: 'in_progress', conclusion: null }], sha),
    'pending',
  );
  assert.equal(determineGateOutcome([{ ...baseline, conclusion: 'failure' }], sha), 'failed');
  assert.equal(determineGateOutcome([{ ...baseline, conclusion: 'cancelled' }], sha), 'failed');
  assert.equal(determineGateOutcome([], sha), 'pending');
  assert.equal(
    determineGateOutcome(
      [
        { ...baseline, run_attempt: 1, conclusion: 'failure' },
        { ...baseline, run_attempt: 2, conclusion: 'success' },
      ],
      sha,
    ),
    'success',
  );
});

test('rejects incomplete commit comparisons and unauthorized deployment refs', () => {
  assert.deepEqual(
    assertSafeCompare({
      status: 'ahead',
      ahead_by: 1,
      files: [{ filename: 'packages/db/a.ts' }],
    }),
    ['packages/db/a.ts'],
  );
  assert.throws(() => assertSafeCompare({ status: 'diverged', ahead_by: 1, files: [] }));
  assert.throws(() =>
    assertSafeCompare({ status: 'ahead', ahead_by: 1, files: Array(300).fill({ filename: 'x' }) }),
  );
  assert.throws(() => assertSafeCompare({ status: 'ahead', ahead_by: 251, files: [] }));
  assert.throws(() => assertSafeCompare({ status: 'ahead', ahead_by: 0, files: [] }));
  assert.doesNotThrow(() => validateDeployRef('main'));
  assert.doesNotThrow(() => validateDeployRef(sha));
  assert.throws(() => validateDeployRef('feature-branch'));
  assert.throws(() => validateDeployRef('main;curl example'));
});
