import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowExplicitProductionProofRecovery,
  assertAutomaticProductionBaseline,
  assertHistoricalRollbackEvidence,
  assertSafeCompare,
  determineGateOutcome,
  needsPostgresIntegration,
  needsValorantPredeployRehearsal,
  needsRuntimeDeployment,
  selectManualDeploymentBoundary,
  validateCompletedMainCi,
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

test('VALORANT migration and deploy guard changes require same-SHA isolated restore CI', () => {
  const guarded = [
    'packages/db/prisma/migrations/20261103160000_valorant_voice_participants/migration.sql',
    'deploy/scripts/valorant-predeploy-rehearsal.sh',
    'deploy/scripts/production-quality-gate.mjs',
    '.github/workflows/deploy-production.yml',
    '.github/workflows/valorant-predeploy-rehearsal.yml',
  ];
  for (const path of guarded) {
    assert.equal(needsValorantPredeployRehearsal([path]), true, path);
  }
  assert.equal(needsValorantPredeployRehearsal(['docs/README.md']), false);
  assert.equal(needsValorantPredeployRehearsal(['apps/bot/src/main.ts']), false);
  const gate = readFileSync(new URL('./production-quality-gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /manualMain \|\| needsValorantPredeployRehearsal\(files\)/);
  assert.match(gate, /required.push\(VALORANT_REHEARSAL_WORKFLOW\)/);
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
  assert.equal(
    determineGateOutcome(
      [
        {
          ...baseline,
          created_at: '2026-11-01T10:00:00Z',
          run_attempt: 3,
          conclusion: 'success',
        },
        {
          ...baseline,
          created_at: '2026-11-02T10:00:00Z',
          run_attempt: 1,
          conclusion: 'failure',
        },
      ],
      sha,
    ),
    'failed',
  );
});

test('manual main uses attested cumulative production delta, not target first parent', () => {
  const current = 'c'.repeat(40);
  const previous = 'a'.repeat(40);
  const firstParent = 'b'.repeat(40);
  assert.deepEqual(
    selectManualDeploymentBoundary({
      requestedRef: 'main',
      sha: current,
      firstParentSha: firstParent,
      attestedSha: previous,
    }),
    { before: previous, mode: 'attested-cumulative' },
  );
});

test('manual re-deploy of attested same-SHA main still executes required checks', () => {
  const firstParent = 'b'.repeat(40);
  assert.deepEqual(
    selectManualDeploymentBoundary({
      requestedRef: 'main',
      sha,
      firstParentSha: firstParent,
      attestedSha: sha,
    }),
    { before: firstParent, mode: 'same-sha-redeploy' },
  );
  const gate = readFileSync(new URL('./production-quality-gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /const manualMain = event === 'workflow_dispatch' && requestedRef === 'main'/);
  assert.match(gate, /manualMain \|\| needsPostgresIntegration\(files\)/);
  assert.match(gate, /manualMain \|\| needsValorantPredeployRehearsal\(files\)/);
});

test('manual bootstrap is explicit and permitted only before first attested SSH baseline', () => {
  const current = 'c'.repeat(40);
  const firstParent = 'b'.repeat(40);
  const bootstrap = {
    requestedRef: 'main',
    sha: current,
    firstParentSha: firstParent,
    attestedSha: null,
  };
  assert.throws(() => selectManualDeploymentBoundary(bootstrap), /Missing attested production SHA/);
  assert.deepEqual(selectManualDeploymentBoundary({ ...bootstrap, bootstrapApproved: true }), {
    before: firstParent,
    mode: 'first-bootstrap',
  });
  for (const candidate of [
    { ...bootstrap, attestedSha: sha, bootstrapApproved: true },
    { ...bootstrap, attestedSha: 'invalid', bootstrapApproved: true },
    { ...bootstrap, requestedRef: current, bootstrapApproved: true },
    { ...bootstrap, firstParentSha: 'invalid', bootstrapApproved: true },
  ]) {
    assert.throws(() => selectManualDeploymentBoundary(candidate));
  }
  const gate = readFileSync(new URL('./production-quality-gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /error.message === 'No successful production SSH deployment baseline'/);
  assert.match(gate, /loadLatestProductionAttestation\(api\)/);
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /bootstrap_without_proof:\n\s+description:/);
  assert.match(workflow, /type: boolean\n\s+required: true\n\s+default: false/);
  assert.match(workflow, /emergency_rollback_without_proof:\n\s+description:/);
  const bootstrapEnv = workflow.split('DEPLOY_BOOTSTRAP_APPROVED: ')[1]?.split('\n')[0];
  const emergencyEnv = workflow.split('DEPLOY_EMERGENCY_ROLLBACK_APPROVED: ')[1]?.split('\n')[0];
  assert.equal(bootstrapEnv, "${{ github.event.inputs.bootstrap_without_proof || 'false' }}");
  assert.equal(
    emergencyEnv,
    "${{ github.event.inputs.emergency_rollback_without_proof || 'false' }}",
  );
});

test('manual historical rollback uses target first parent and requires trusted proof', () => {
  const historical = 'b'.repeat(40);
  const current = 'c'.repeat(40);
  assert.deepEqual(
    selectManualDeploymentBoundary({
      requestedRef: historical,
      sha: historical,
      firstParentSha: 'a'.repeat(40),
      attestedSha: current,
    }),
    { before: 'a'.repeat(40), mode: 'explicit-historical-rollback' },
  );
  for (const candidate of [null, undefined, 'not-a-sha']) {
    assert.throws(() =>
      selectManualDeploymentBoundary({
        requestedRef: historical,
        sha: historical,
        firstParentSha: 'a'.repeat(40),
        attestedSha: candidate,
      }),
    );
  }
});

test('explicit operator emergency rollback preserves recovery after failed production SSH', () => {
  const historic = 'b'.repeat(40);
  const target = {
    requestedRef: historic,
    sha: historic,
    firstParentSha: 'a'.repeat(40),
    attestedSha: null,
    mainSha: 'c'.repeat(40),
  };
  assert.throws(
    () => selectManualDeploymentBoundary(target),
    /requires a verified current production baseline/,
  );
  assert.deepEqual(selectManualDeploymentBoundary({ ...target, emergencyRollbackApproved: true }), {
    before: 'a'.repeat(40),
    mode: 'operator-emergency-rollback',
  });
  for (const invalid of [
    { ...target, requestedRef: 'main', emergencyRollbackApproved: true },
    { ...target, mainSha: historic, emergencyRollbackApproved: true },
    { ...target, mainSha: undefined, emergencyRollbackApproved: true },
    { ...target, attestedSha: 'c'.repeat(40), emergencyRollbackApproved: true },
    { ...target, bootstrapApproved: true, emergencyRollbackApproved: true },
  ]) {
    assert.throws(() => selectManualDeploymentBoundary(invalid));
  }
});

test('emergency approval bypasses only recognized failed-SSH or missing-proof states', () => {
  const emergency = { emergencyRollbackApproved: true };
  const bootstrap = { bootstrapApproved: true };
  const firstEver = new Error('No successful production SSH deployment baseline');
  assert.equal(allowExplicitProductionProofRecovery(firstEver, bootstrap), true);
  assert.equal(allowExplicitProductionProofRecovery(firstEver, emergency), true);
  assert.equal(allowExplicitProductionProofRecovery(firstEver, {}), false);
  assert.equal(
    allowExplicitProductionProofRecovery(firstEver, {
      bootstrapApproved: true,
      emergencyRollbackApproved: true,
    }),
    false,
  );

  for (const reason of [
    'Latest production SSH attempt failed or lacks completed health/proof',
    'Missing, duplicate or incomplete production provenance record',
    'Untrusted, missing or malformed successful deployment attestation',
  ]) {
    assert.equal(allowExplicitProductionProofRecovery(new Error(reason), emergency), true);
    assert.equal(allowExplicitProductionProofRecovery(new Error(reason), bootstrap), false);
  }
  for (const reason of [
    'GitHub Actions metadata request failed: HTTP 403',
    'GitHub Actions metadata request failed: network error',
    'Production SSH attempt is still running or unverified',
    'Incomplete production job history',
    'Cannot uniquely order concurrent production SSH attempts',
    'Unknown error',
  ]) {
    assert.equal(allowExplicitProductionProofRecovery(new Error(reason), emergency), false);
    assert.equal(allowExplicitProductionProofRecovery(new Error(reason), bootstrap), false);
  }
  assert.equal(allowExplicitProductionProofRecovery('Invalid error', emergency), false);
});

test('historical rollback refuses missing or pending main CI immediately', () => {
  const historical = 'a'.repeat(40);
  const current = 'b'.repeat(40);
  const failedStates = [
    { name: 'CI', state: 'success' },
    { name: 'Database topology contracts', state: 'pending' },
  ];
  assert.throws(
    () => assertHistoricalRollbackEvidence(failedStates, historical, historical, current),
    /Database topology contracts/,
  );
  assert.doesNotThrow(() =>
    assertHistoricalRollbackEvidence(failedStates, 'main', historical, current),
  );
  assert.doesNotThrow(() =>
    assertHistoricalRollbackEvidence(failedStates, historical, historical, historical),
  );
  assert.doesNotThrow(() =>
    assertHistoricalRollbackEvidence(
      [
        { name: 'CI', state: 'success' },
        { name: 'Database topology contracts', state: 'success' },
      ],
      historical,
      historical,
      current,
    ),
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

test('runtime-only deployment skips docs, skills and monitoring-only changes', () => {
  for (const file of [
    'apps/bot/src/plugins/vc-recap.ts',
    'packages/db/schema.ts',
    'plugins/vc-recap.ts',
    'contracts/tickets.yaml',
    'deploy/scripts/production-quality-gate.mjs',
    '.env.production.example',
    'docker-compose.prod.yml',
    'certs/production.pem',
    'Dockerfile',
  ]) {
    assert.equal(needsRuntimeDeployment([file]), true, file);
  }
  for (const file of [
    'docs/VC_RECAP_TICKET.md',
    '.agents/skills/README.md',
    '.github/workflows/deploy-production.yml',
    'deploy/aws/backup-monitoring/README.md',
  ]) {
    assert.equal(needsRuntimeDeployment([file]), false, file);
  }
  assert.equal(
    needsRuntimeDeployment(['docs/VC_RECAP.md', 'apps/bot/src/voice/vc-recap.ts']),
    true,
  );
});

test('automatic production baseline refuses manual rollback and unverifiable SSH history', () => {
  const automatic = { head_sha: sha, head_branch: 'main', event: 'workflow_run' };
  assert.equal(assertAutomaticProductionBaseline(automatic), sha);
  assert.equal(assertAutomaticProductionBaseline({ ...automatic, event: 'push' }), sha);

  for (const candidate of [
    undefined,
    { ...automatic, event: 'workflow_dispatch' },
    { ...automatic, event: 'pull_request' },
    { ...automatic, event: 'unknown' },
    { ...automatic, head_branch: 'feature' },
    { ...automatic, head_sha: 'not-a-sha' },
  ]) {
    assert.throws(
      () => assertAutomaticProductionBaseline(candidate),
      /attested automatic main SHA/,
    );
  }
});

test('workflow_run trusts only successful same-SHA main push CI in this repo', () => {
  const repo = 'ivRooom/Herta';
  const run = {
    name: 'CI',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: sha,
    repository: { full_name: repo },
    head_repository: { full_name: repo },
  };
  const valid = { action: 'completed', repository: { full_name: repo }, workflow_run: run };
  assert.equal(validateCompletedMainCi(valid, repo, sha), sha);
  const invalids = [
    { ...valid, action: 'requested' },
    { ...valid, repository: { full_name: 'evil/fork' } },
    { ...valid, workflow_run: { ...run, name: 'other' } },
    { ...valid, workflow_run: { ...run, event: 'pull_request' } },
    { ...valid, workflow_run: { ...run, status: 'in_progress' } },
    { ...valid, workflow_run: { ...run, conclusion: 'failure' } },
    { ...valid, workflow_run: { ...run, head_branch: 'feature' } },
    { ...valid, workflow_run: { ...run, head_sha: 'b'.repeat(40) } },
    { ...valid, workflow_run: { ...run, repository: { full_name: 'evil/fork' } } },
    { ...valid, workflow_run: { ...run, head_repository: { full_name: 'evil/fork' } } },
    { ...valid, workflow_run: { ...run, head_sha: 'bad' } },
    { ...valid, workflow_run: null },
  ];
  for (const payload of invalids) {
    assert.throws(() => validateCompletedMainCi(payload, repo, sha));
  }
});

test('VALORANT predeploy rehearsal always runs on main, even after a later nginx-only push', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/valorant-predeploy-rehearsal.yml', import.meta.url),
    'utf8',
  );
  const sections = source.split('\n  push:\n');
  assert.equal(sections.length, 2, 'Exactly one main push trigger is required');
  const pullRequest = sections[0].split('\n  pull_request:\n')[1];
  assert.ok(pullRequest?.includes('    paths:'), 'PR runs should remain path-scoped');
  const mainPush = sections[1].split('\npermissions:\n')[0];
  assert.ok(mainPush.includes('    branches: [main]'));
  assert.ok(!mainPush.includes('    paths:'), 'main must not skip the same-SHA rehearsal');
});

test('isolated PostgreSQL integration runs for every main SHA, including carryover Bot changes', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/valorant-agents.yml', import.meta.url),
    'utf8',
  );
  const sections = source.split('\n  push:\n');
  assert.equal(sections.length, 2, 'Only one push trigger may exist');
  const mainPush = sections[1].split('\npermissions:\n')[0];
  assert.ok(mainPush.includes('    branches: [main]'));
  assert.ok(!mainPush.includes('paths:'), 'main push must not skip a required PG result');
});

test('production workflow has an unprivileged CI-completion gate before build and SSH', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const [gate, buildRest] = source.split('\n  build-image:\n');
  assert.ok(buildRest, 'Build job must exist');
  const [build, deploy] = buildRest.split('\n  deploy:\n');
  assert.ok(deploy, 'SSH deploy job must exist');

  assert.ok(
    source.includes(
      '  workflow_run:\n    workflows: [CI]\n    types: [completed]\n    branches: [main]',
    ),
  );
  assert.ok(!source.includes('\n  push:\n'));
  assert.ok(gate.includes('name: Verified main CI gate'));
  assert.ok(gate.includes("if: github.ref == 'refs/heads/main'"));
  assert.ok(gate.includes('contents: read\n      actions: read'));
  assert.ok(gate.includes('should_deploy:'));
  assert.ok(gate.includes('run: node deploy/scripts/production-quality-gate.mjs'));
  assert.ok(build.includes("needs.quality-gate.outputs.should_deploy == 'true'"));
  assert.ok(build.includes('needs: quality-gate'));
  assert.ok(build.includes('needs.quality-gate.outputs.deploy_sha'));
  assert.ok(build.includes('persist-credentials: false'));
  assert.ok(build.includes("github.event_name != 'workflow_dispatch'"));
  assert.ok(deploy.includes('needs: [quality-gate, build-image]'));
  assert.ok(deploy.includes('environment: production'));
  assert.ok(deploy.includes("github.event_name != 'workflow_dispatch'"));
});

test('VALORANT production migration is fenced by protected backup and isolated restore before Compose up', () => {
  const scriptPath = new URL('./valorant-predeploy-rehearsal.sh', import.meta.url);
  execFileSync('bash', ['-n', scriptPath.pathname], { stdio: 'pipe' });
  const script = readFileSync(scriptPath, 'utf8');
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const [ssh, health] = workflow.split('      - name: Cloudflare経由の外部Health check');
  assert.ok(ssh && health, 'expected the production SSH deploy job');
  const gate = ssh.indexOf('bash deploy/scripts/valorant-predeploy-rehearsal.sh');
  assert.ok(
    ssh.includes('if [[ -f deploy/scripts/valorant-predeploy-rehearsal.sh ]]; then'),
    'existing predeploy script must be run on the selected revision',
  );
  assert.ok(
    ssh.includes(
      'elif [[ -f packages/db/prisma/migrations/20261103160000_valorant_voice_participants/migration.sql ]]; then',
    ),
    'rollback without script is allowed only when migration is absent',
  );
  assert.ok(
    ssh.includes('VALORANT migration exists without its predeploy safety gate.'),
    'migration without safety script must stop before image pull',
  );
  assert.ok(gate > ssh.indexOf('config --quiet'), 'must validate Compose before backup');
  assert.ok(gate < ssh.indexOf('pull_production_images'), 'must backup before image pull');
  assert.ok(
    gate < ssh.indexOf('start_production_services'),
    'must rehearse before migrator startup',
  );
  assert.match(script, /HERTA_SELECTED_DATABASE_MODE.*!= local/);
  assert.match(script, /DEPLOY_REF:-/);
  assert.match(script, /pg_dump -Fc/);
  assert.match(script, /sha256sum --check --status/);
  assert.match(script, /--network none --memory 256m/);
  assert.match(script, /pg_restore --no-owner --no-acl --exit-on-error/);
  assert.match(script, /psql -X -v ON_ERROR_STOP=1/);
  assert.match(script, /docker info --format/);
  assert.match(script, /docker_free_kib/);
  assert.match(script, /docker_required_kib/);
  assert.match(script, /docker rm -f -v "\$restore_id"/);
  assert.doesNotMatch(
    script,
    /docker volume rm|docker system prune|pg_restore.*\$COMPOSE|DROP DATABASE/,
  );
});

test('new VALORANT expiry migration must be protected by fresh backup and offline PG16 restore', () => {
  const gate = readFileSync(new URL('./production-quality-gate.mjs', import.meta.url), 'utf8');
  const deploy = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const rehearsal = readFileSync(
    new URL('../../.github/workflows/valorant-predeploy-rehearsal.yml', import.meta.url),
    'utf8',
  );
  const script = readFileSync(
    new URL('./valorant-expiry-predeploy-rehearsal.sh', import.meta.url),
    'utf8',
  );
  const newMigration = '20261104093000_valorant_expiry_ui_reconcile';
  assert.match(gate, /valorant-expiry-predeploy-rehearsal/);
  assert.ok(gate.includes(newMigration));
  assert.ok(deploy.includes('bash deploy/scripts/valorant-expiry-predeploy-rehearsal.sh'));
  assert.ok(
    deploy.includes('expiry UI migration exists without its protected backup/restore gate'),
  );
  assert.ok(rehearsal.includes('bash deploy/scripts/valorant-expiry-predeploy-rehearsal.sh'));
  assert.ok(rehearsal.includes('partially applied expiry UI migration'));
  assert.ok(rehearsal.includes('tampered applied expiry UI migration checksum'));
  assert.ok(script.includes(newMigration));
  assert.ok(script.includes('pg_dump -Fc'));
  assert.ok(script.includes('pg_restore --no-owner --no-acl --exit-on-error'));
  assert.ok(script.includes('--network none'));
  assert.ok(script.includes('docker rm -f -v "$restore_id"'));
});
