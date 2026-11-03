import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertAutomaticProductionBaseline,
  assertHistoricalRollbackEvidence,
  assertSafeCompare,
  determineGateOutcome,
  needsPostgresIntegration,
  needsRuntimeDeployment,
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
  assert.match(script, /docker rm -f "\$restore_id"/);
  assert.doesNotMatch(
    script,
    /docker volume rm|docker system prune|pg_restore.*\$COMPOSE|DROP DATABASE/,
  );
});
