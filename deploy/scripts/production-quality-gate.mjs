import { appendFileSync, readFileSync } from 'node:fs';
import { loadLatestProductionAttestation } from './production-provenance.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const REQUIRED_WORKFLOWS = [
  { file: 'ci.yml', name: 'CI' },
  { file: 'database-topology.yml', name: 'Database topology contracts' },
];
const PG_WORKFLOW = { file: 'valorant-agents.yml', name: 'VALORANT PostgreSQL integration' };
const VALORANT_REHEARSAL_WORKFLOW = {
  file: 'valorant-predeploy-rehearsal.yml',
  name: 'VALORANT predeploy restore rehearsal',
};

// The retired push.paths allowlist is enforced here for workflow_run so
// docs-only and Agent Skills-only commits never restart production.
const RUNTIME_DIRS = ['apps/', 'packages/', 'plugins/', 'contracts/', 'deploy/', 'certs/'];
const RUNTIME_FILES = new Set([
  'Dockerfile',
  '.dockerignore',
  'docker-compose.prod.yml',
  'docker-compose.common.yml',
  'docker-compose.external.yml',
  '.env.example',
  '.env.production.example',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
]);

export function needsRuntimeDeployment(files) {
  return files.some(
    (file) =>
      RUNTIME_FILES.has(file) ||
      (RUNTIME_DIRS.some((prefix) => file.startsWith(prefix)) &&
        !file.startsWith('deploy/aws/backup-monitoring/')),
  );
}

/**
 * workflow_run is a privileged event: neither a PR, a fork, an old main commit,
 * nor a failed CI run is allowed to launch production build or acquire OIDC.
 */
export function validateCompletedMainCi(payload, repository, mainSha) {
  const run = payload?.workflow_run;
  if (
    payload?.action !== 'completed' ||
    payload?.repository?.full_name !== repository ||
    !run ||
    run.name !== 'CI' ||
    run.event !== 'push' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_branch !== 'main' ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== mainSha ||
    !SHA_RE.test(run.head_sha)
  ) {
    throw new Error('Only successful same-SHA main push CI can trigger production');
  }
  return run.head_sha;
}

/** A successful SSH job alone cannot prove the deployed SHA after a manual rollback. */
export function assertAutomaticProductionBaseline(run) {
  if (
    !run ||
    !SHA_RE.test(run.head_sha) ||
    run.head_branch !== 'main' ||
    (run.event !== 'push' && run.event !== 'workflow_run')
  ) {
    throw new Error('Last successful production SSH has no attested automatic main SHA');
  }
  return run.head_sha;
}
const PG_PATHS = [
  /^packages\/db\//,
  /^apps\/bot\//,
  /^apps\/studio\//,
  /^\.github\/workflows\/valorant-agents\.yml$/,
];

export function needsPostgresIntegration(files) {
  return files.some((file) => PG_PATHS.some((pattern) => pattern.test(file)));
}
const VALORANT_REHEARSAL_PATHS = [
  /^deploy\/scripts\/valorant-predeploy-rehearsal\.sh$/,
  /^deploy\/scripts\/valorant-expiry-predeploy-rehearsal\.sh$/,
  /^deploy\/scripts\/production-quality-gate\.mjs$/,
  /^\.github\/workflows\/deploy-production\.yml$/,
  /^\.github\/workflows\/valorant-predeploy-rehearsal\.yml$/,
  /^packages\/db\/prisma\/migrations\/20261103160000_valorant_voice_participants\//,
  /^packages\/db\/prisma\/migrations\/20261104093000_valorant_expiry_ui_reconcile\//,
];
export function needsValorantPredeployRehearsal(files) {
  return files.some((file) => VALORANT_REHEARSAL_PATHS.some((pattern) => pattern.test(file)));
}

export function determineGateOutcome(runs, sha) {
  const candidates = runs
    .filter((run) => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push')
    .sort(
      (a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)) ||
        (b.run_attempt ?? 1) - (a.run_attempt ?? 1),
    );
  const run = candidates[0];
  if (!run) return 'pending';
  if (run.status !== 'completed') return 'pending';
  return run.conclusion === 'success' ? 'success' : 'failed';
}

export function assertSafeCompare(compare) {
  if (
    !compare ||
    compare.status !== 'ahead' ||
    !Array.isArray(compare.files) ||
    compare.files.length >= 300 ||
    compare.ahead_by > 250 ||
    !Number.isSafeInteger(compare.ahead_by) ||
    compare.ahead_by < 1
  ) {
    throw new Error('Commit comparison cannot establish a complete safe change set');
  }
  return compare.files.map((file) => file.filename);
}

export function validateDeployRef(ref) {
  if (ref !== 'main' && !SHA_RE.test(ref)) {
    throw new Error('Deploy input must be main or a pinned 40-character commit SHA');
  }
}

/**
 * A manual main release must compare with the most recent *attested runtime*,
 * just like workflow_run. First-parent comparison is only safe when the exact
 * target SHA is already deployed or an explicit first-ever bootstrap is approved.
 *
 * An explicit historical SHA is a separate rollback: verify the current proof
 * before proceeding, but keep the target's first-parent CI boundary so old main
 * revisions without newer workflow files remain recoverable.
 */
export function allowExplicitProductionProofRecovery(
  error,
  { bootstrapApproved = false, emergencyRollbackApproved = false },
) {
  if (!(error instanceof Error) || bootstrapApproved === emergencyRollbackApproved) {
    return false;
  }
  if (bootstrapApproved) {
    return error.message === 'No successful production SSH deployment baseline';
  }
  // These are known, verifiable interrupted-release states; unknown API errors,
  // incomplete pagination, permission failures and in-flight SSH are not bypassed.
  return [
    'Latest production SSH attempt failed or lacks completed health/proof',
    'Missing, duplicate or incomplete production provenance record',
    'Untrusted, missing or malformed successful deployment attestation',
    'No successful production SSH deployment baseline',
  ].includes(error.message);
}

export function selectManualDeploymentBoundary({
  requestedRef,
  sha,
  firstParentSha,
  attestedSha,
  mainSha,
  bootstrapApproved = false,
  emergencyRollbackApproved = false,
}) {
  validateDeployRef(requestedRef);
  if (!SHA_RE.test(sha) || !SHA_RE.test(firstParentSha)) {
    throw new Error('Cannot establish the manual production commit boundary');
  }
  if (bootstrapApproved && emergencyRollbackApproved) {
    throw new Error('Bootstrap and emergency rollback approvals are mutually exclusive');
  }
  if (bootstrapApproved && (requestedRef !== 'main' || attestedSha !== null)) {
    throw new Error('Explicit bootstrap is only valid before the first production SSH baseline');
  }
  if (
    emergencyRollbackApproved &&
    (requestedRef === 'main' || !SHA_RE.test(mainSha) || sha === mainSha || attestedSha !== null)
  ) {
    throw new Error('Emergency rollback requires a historical SHA and missing trustworthy proof');
  }
  if (requestedRef === 'main') {
    if (attestedSha === null) {
      if (!bootstrapApproved) throw new Error('Missing attested production SHA for manual main');
      return { before: firstParentSha, mode: 'first-bootstrap' };
    }
    if (!SHA_RE.test(attestedSha)) throw new Error('Invalid attested production SHA');
    if (attestedSha === sha) {
      // Intentional re-deploy: keep the main-push checks instead of a no-op.
      return { before: firstParentSha, mode: 'same-sha-redeploy' };
    }
    return { before: attestedSha, mode: 'attested-cumulative' };
  }
  if (attestedSha === null && emergencyRollbackApproved) {
    // Recoverability after a partially failed SSH deployment. The operator
    // selects a pinned, main-ancestry SHA; historical CI and protected
    // production Environment approval remain mandatory.
    return { before: firstParentSha, mode: 'operator-emergency-rollback' };
  }
  if (!SHA_RE.test(attestedSha)) {
    throw new Error('Manual rollback requires a verified current production baseline');
  }
  return { before: firstParentSha, mode: 'explicit-historical-rollback' };
}

export function assertHistoricalRollbackEvidence(states, requestedRef, sha, mainSha) {
  if (requestedRef === 'main' || sha === mainSha) return;
  const missing = states.filter((state) => state.state !== 'success').map((state) => state.name);
  if (missing.length) {
    throw new Error('Rollback SHA lacks completed successful main-push CI: ' + missing.join(', '));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const event = process.env.GITHUB_EVENT_NAME;
  const requestedRef = process.env.DEPLOY_REQUESTED_REF || 'main';
  if (
    !repository ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !token ||
    !['push', 'workflow_dispatch', 'workflow_run'].includes(event)
  ) {
    throw new Error('Invalid GitHub Actions environment for the production quality gate');
  }
  validateDeployRef(requestedRef);
  const rawBootstrap = process.env.DEPLOY_BOOTSTRAP_APPROVED ?? 'false';
  if (!['true', 'false'].includes(rawBootstrap)) {
    throw new Error('Invalid explicit bootstrap approval value');
  }
  const bootstrapApproved = rawBootstrap === 'true';
  const rawEmergencyRollback = process.env.DEPLOY_EMERGENCY_ROLLBACK_APPROVED ?? 'false';
  if (!['true', 'false'].includes(rawEmergencyRollback)) {
    throw new Error('Invalid emergency rollback approval value');
  }
  const emergencyRollbackApproved = rawEmergencyRollback === 'true';
  if ((bootstrapApproved || emergencyRollbackApproved) && event !== 'workflow_dispatch') {
    throw new Error('Recovery approvals require a manual dispatch');
  }
  if (bootstrapApproved && (requestedRef !== 'main' || emergencyRollbackApproved)) {
    throw new Error('Bootstrap approval requires a manual main deployment');
  }
  if (emergencyRollbackApproved && requestedRef === 'main') {
    throw new Error('Emergency rollback cannot target current main');
  }

  const api = async (path) => {
    let failure = 'network error';
    for (let attempt = 1; attempt <= 3; attempt++) {
      let retry = true;
      try {
        const response = await fetch('https://api.github.com/repos/' + repository + '/' + path, {
          headers: {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) return response.json();
        failure = 'HTTP ' + response.status;
        retry = response.status === 429 || response.status >= 500;
      } catch {
        failure = 'network error';
      }
      if (!retry || attempt === 3) break;
      await sleep(1000 * attempt);
    }
    throw new Error('GitHub Actions metadata request failed: ' + failure);
  };
  const currentMain = async () => (await api('branches/main')).commit.sha;
  const triggeredSha = process.env.GITHUB_SHA;
  const mainSha = await currentMain();
  let workflowRunSha;
  if (event === 'workflow_run') {
    if (requestedRef !== 'main' || !process.env.GITHUB_EVENT_PATH) {
      throw new Error('Automatic workflow_run must deploy current main only');
    }
    let payload;
    try {
      payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    } catch {
      throw new Error('Cannot read authenticated GitHub workflow_run event');
    }
    workflowRunSha = validateCompletedMainCi(payload, repository, mainSha);
  }
  const sha =
    requestedRef !== 'main'
      ? requestedRef
      : event === 'workflow_run'
        ? workflowRunSha
        : event === 'push'
          ? triggeredSha
          : mainSha;
  if (!SHA_RE.test(sha)) throw new Error('Expected immutable commit SHA');
  if (event === 'push' && requestedRef !== 'main') {
    throw new Error('Automatic production deployments must be from main');
  }
  if (requestedRef === 'main' && sha !== mainSha) {
    throw new Error('Stale main commit: a newer revision has superseded this deployment');
  }

  // For manual rollback, the target must be an ancestor of main, never an arbitrary PR ref.
  if (requestedRef !== 'main') {
    if (sha !== mainSha) {
      const ancestry = await api('compare/' + sha + '...' + mainSha);
      if (!['ahead', 'identical'].includes(ancestry.status)) {
        throw new Error('Requested rollback SHA is not in main history');
      }
    }
  }

  // Compare against the last *actually deployed* SHA, not just the current
  // commit's first parent: an earlier missed deployment may contain Bot changes
  // even when the current CI trigger is docs-only.
  let before = process.env.DEPLOY_PUSH_BEFORE;
  let previousProductionConfirmed = false;
  if (event === 'workflow_run') {
    // A successful SSH job alone does not prove which commit was deployed.
    // Protected release records include an actual four-container image-id readback,
    // pinned SHA, manual rollback target and run attempt. Missing provenance stops
    // automated deployment before build/GHCR/OIDC/SSH.
    const attestation = await loadLatestProductionAttestation(api);
    before = attestation.sha;
    previousProductionConfirmed = true;
  }
  if (event === 'workflow_dispatch') {
    // Manual main must inspect the same protected provenance as automatic
    // releases. Do not interpret a dispatch run's head_sha as rollback SHA.
    // A first-ever bootstrap may use first-parent only with an explicit
    // operator approval and proof that NO prior SSH deployment exists.
    let attestedSha;
    try {
      attestedSha = (await loadLatestProductionAttestation(api)).sha;
    } catch (error) {
      if (
        !allowExplicitProductionProofRecovery(error, {
          bootstrapApproved,
          emergencyRollbackApproved,
        })
      ) {
        throw error;
      }
      attestedSha = null;
    }
    const commit = await api('commits/' + sha);
    const boundary = selectManualDeploymentBoundary({
      requestedRef,
      sha,
      firstParentSha: commit.parents?.[0]?.sha,
      attestedSha,
      mainSha,
      bootstrapApproved,
      emergencyRollbackApproved,
    });
    before = boundary.before;
    console.log('Manual deployment proof boundary: ' + boundary.mode);
  }
  if (event === 'workflow_run' && previousProductionConfirmed && before === sha) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GitHub Actions output file');
    appendFileSync(process.env.GITHUB_OUTPUT, 'should_deploy=false\n');
    console.log('Exact current SHA was already deployed; duplicate release skipped');
    return;
  }
  if (!SHA_RE.test(before) || before === sha) {
    throw new Error('Cannot establish production change boundary');
  }
  const files = assertSafeCompare(await api('compare/' + before + '...' + sha));
  // A docs-only update after a missed Bot deploy MUST still ship the pending
  // Bot changes. Only skip when an authenticated successful production baseline
  // establishes that the *whole* delta is docs/skills/monitoring-only.
  if (event === 'workflow_run' && previousProductionConfirmed && !needsRuntimeDeployment(files)) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GitHub Actions output file');
    appendFileSync(process.env.GITHUB_OUTPUT, 'should_deploy=false\n');
    console.log('No runtime change since successful production SHA; deployment skipped');
    return;
  }
  const required = [...REQUIRED_WORKFLOWS];
  // All current-main pushes run these synthetic DB gates. A manual release
  // must not skip them when an older unshipped migration is hidden by the
  // target commit's first-parent diff, including first boot and same-SHA retry.
  const manualMain = event === 'workflow_dispatch' && requestedRef === 'main';
  if (manualMain || needsPostgresIntegration(files)) required.push(PG_WORKFLOW);
  if (manualMain || needsValorantPredeployRehearsal(files)) {
    required.push(VALORANT_REHEARSAL_WORKFLOW);
  }
  console.log(
    'Production gate for pinned SHA ' +
      sha.slice(0, 12) +
      ': requiring ' +
      required.map((workflow) => workflow.name).join(', '),
  );

  // In-progress CI may take longer than the Docker deployment build. Always wait
  // for successful main push runs on this exact SHA, never trust PR or older runs.
  const deadline = Date.now() + 90 * 60 * 1000;
  while (true) {
    if (requestedRef === 'main' && (await currentMain()) !== sha) {
      throw new Error('main moved while waiting; refusing stale production deployment');
    }
    const states = await Promise.all(
      required.map(async ({ file, name }) => {
        const result = await api(
          'actions/workflows/' +
            encodeURIComponent(file) +
            '/runs?event=push&head_sha=' +
            sha +
            '&per_page=100',
        );
        return { name, state: determineGateOutcome(result.workflow_runs ?? [], sha) };
      }),
    );
    const failed = states.find((state) => state.state === 'failed');
    if (failed) throw new Error('Required check failed or was cancelled: ' + failed.name);
    if (states.every((state) => state.state === 'success')) break;
    assertHistoricalRollbackEvidence(states, requestedRef, sha, mainSha);
    if (Date.now() > deadline) throw new Error('Timed out waiting for required CI checks');
    console.log(
      'Waiting for production CI: ' +
        states.map((state) => state.name + '=' + state.state).join(', '),
    );
    await sleep(25000);
  }

  if (requestedRef === 'main' && (await currentMain()) !== sha) {
    throw new Error('main moved while checking CI; stale revision must not deploy');
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GitHub Actions output file');
  appendFileSync(process.env.GITHUB_OUTPUT, 'deploy_sha=' + sha + '\nshould_deploy=true\n');
  console.log('Production quality checks passed for ' + sha.slice(0, 12));
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown quality gate error');
    process.exitCode = 1;
  });
}
