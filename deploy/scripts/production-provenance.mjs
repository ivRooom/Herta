export const RUNTIME_ATTESTATION_ENVIRONMENT = 'herta-runtime-attested';
export const RUNTIME_ATTESTATION_TASK = 'deploy:runtime-proof';
export const RUNTIME_SERVICES = ['api', 'bot', 'studio', 'worker'];
const SHA_RE = /^[a-f0-9]{40}$/;
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REPOSITORY = 'ghcr.io/ivrooom/herta';

export function parseProductionRuntimeProof(stdout, expectedSha) {
  if (!SHA_RE.test(expectedSha) || typeof stdout !== 'string') {
    throw new Error('Invalid expected production SHA or SSH stdout');
  }
  const proofs = [
    ...stdout.matchAll(
      /(?:^|\n)(?:out:[ \t]*)?HERTA_RELEASE_PROOF[ \t]+([a-f0-9]{40})[ \t]+(sha256:[a-f0-9]{64})(?=\r?\n|$)/g,
    ),
  ];
  if (proofs.length !== 1 || proofs[0][1] !== expectedSha) {
    throw new Error('Missing, duplicate, stale or malformed Lightsail runtime proof');
  }
  return { sha: expectedSha, imageId: proofs[0][2] };
}

export function buildProductionDeploymentPayload({ runId, runAttempt, sha, imageId, actor }) {
  if (
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt < 1 ||
    !SHA_RE.test(sha) ||
    !IMAGE_ID_RE.test(imageId) ||
    typeof actor !== 'string' ||
    !/^[A-Za-z0-9-]{1,39}$/.test(actor)
  ) {
    throw new Error('Unverifiable production provenance input');
  }
  return {
    schemaVersion: 1,
    runId,
    runAttempt,
    sha,
    imageRef: IMAGE_REPOSITORY + ':' + sha,
    imageId,
    actor,
    environment: 'production',
    source: 'lightsail-ssh-container-readback',
    services: RUNTIME_SERVICES,
  };
}

export function selectLatestSuccessfulSshDeployment(runsWithJobs) {
  if (!Array.isArray(runsWithJobs)) throw new Error('Missing complete run history');
  const attempts = [];
  for (const { run, jobs } of runsWithJobs) {
    if (!run || !Array.isArray(jobs) || !Number.isSafeInteger(run.id)) {
      throw new Error('Unverifiable production run history');
    }
    // A failing workflow may have already updated the host. Do NOT fall back
    // to a prior successful run after SSH+Cloudflare/provenance failure.
    const attempted = jobs.filter((job) =>
      job.steps?.some(
        (step) =>
          step.name === 'LightsailへSSHデプロイ' &&
          step.status !== 'pending' &&
          step.conclusion !== 'skipped',
      ),
    );
    if (attempted.length > 1) {
      throw new Error('Multiple SSH attempts in one production workflow run');
    }
    if (attempted.length === 1) {
      const job = attempted[0];
      const completedMs = Date.parse(job.completed_at ?? '');
      if (!Number.isFinite(completedMs)) {
        throw new Error('Production SSH attempt is still running or unverified');
      }
      attempts.push({ run, job, completedMs });
    }
  }
  attempts.sort((a, b) => b.completedMs - a.completedMs || b.run.id - a.run.id);
  if (attempts.length > 1 && attempts[0].completedMs === attempts[1].completedMs) {
    throw new Error('Cannot uniquely order concurrent production SSH attempts');
  }
  const latest = attempts[0];
  if (!latest) return null;
  if (
    latest.run.status !== 'completed' ||
    latest.run.conclusion !== 'success' ||
    !['push', 'workflow_run', 'workflow_dispatch'].includes(latest.run.event) ||
    !Number.isSafeInteger(latest.run.run_attempt) ||
    latest.job.status !== 'completed' ||
    latest.job.conclusion !== 'success' ||
    !latest.job.steps.some(
      (step) => step.name === 'LightsailへSSHデプロイ' && step.conclusion === 'success',
    )
  ) {
    throw new Error('Latest production SSH attempt failed or lacks completed health/proof');
  }
  return latest;
}

export function validateProductionDeploymentAttestation({ run, job, deployment, statuses }) {
  const payload = deployment?.payload;
  if (
    !run ||
    !job ||
    !deployment ||
    deployment.environment !== RUNTIME_ATTESTATION_ENVIRONMENT ||
    deployment.task !== RUNTIME_ATTESTATION_TASK ||
    !SHA_RE.test(deployment.sha) ||
    !payload ||
    payload.schemaVersion !== 1 ||
    !Number.isSafeInteger(payload.runId) ||
    payload.runId !== run.id ||
    !Number.isSafeInteger(payload.runAttempt) ||
    payload.runAttempt !== run.run_attempt ||
    payload.sha !== deployment.sha ||
    payload.imageRef !== IMAGE_REPOSITORY + ':' + deployment.sha ||
    !IMAGE_ID_RE.test(payload.imageId) ||
    payload.actor !== run.actor?.login ||
    payload.environment !== 'production' ||
    payload.source !== 'lightsail-ssh-container-readback' ||
    !Array.isArray(payload.services) ||
    payload.services.join(',') !== RUNTIME_SERVICES.join(',') ||
    !Array.isArray(statuses) ||
    statuses.length === 0 ||
    statuses[0].state !== 'success'
  ) {
    throw new Error('Untrusted, missing or malformed successful deployment attestation');
  }
  const created = Date.parse(deployment.created_at ?? '');
  const sshStarted = Date.parse(job.started_at ?? '');
  const sshCompleted = Date.parse(job.completed_at ?? '');
  const statusCreated = Date.parse(statuses[0].created_at ?? '');
  if (
    [created, sshStarted, sshCompleted, statusCreated].some((x) => !Number.isFinite(x)) ||
    created < sshStarted ||
    created > sshCompleted ||
    statusCreated < created ||
    statusCreated > sshCompleted
  ) {
    throw new Error('Runtime proof was not issued during the successful SSH deployment job');
  }
  return deployment.sha;
}

export async function loadLatestProductionAttestation(api) {
  const result = await api('actions/workflows/deploy-production.yml/runs?branch=main&per_page=100');
  if (!Array.isArray(result.workflow_runs)) throw new Error('Missing production workflow runs');
  const runsWithJobs = [];
  for (const run of result.workflow_runs) {
    const data = await api('actions/runs/' + run.id + '/jobs?per_page=100');
    if (!Array.isArray(data.jobs) || data.total_count > data.jobs.length) {
      throw new Error('Incomplete production job history');
    }
    runsWithJobs.push({ run, jobs: data.jobs });
  }
  const latest = selectLatestSuccessfulSshDeployment(runsWithJobs);
  if (!latest) throw new Error('No successful production SSH deployment baseline');
  const matches = [];
  let fullyRead = false;
  for (let page = 1; page <= 10; page++) {
    const records = await api(
      'deployments?environment=' + RUNTIME_ATTESTATION_ENVIRONMENT + '&per_page=100&page=' + page,
    );
    if (!Array.isArray(records)) throw new Error('Invalid production proof pagination');
    matches.push(
      ...records.filter(
        (item) =>
          item.payload?.runId === latest.run.id &&
          item.payload?.runAttempt === latest.run.run_attempt,
      ),
    );
    if (records.length < 100) {
      fullyRead = true;
      break;
    }
  }
  if (!fullyRead || matches.length !== 1) {
    throw new Error('Missing, duplicate or incomplete production provenance record');
  }
  const deployment = matches[0];
  const statusResult = await api('deployments/' + deployment.id + '/statuses?per_page=100');
  const sha = validateProductionDeploymentAttestation({
    run: latest.run,
    job: latest.job,
    deployment,
    statuses: statusResult,
  });
  return { sha, runId: latest.run.id, imageId: deployment.payload.imageId };
}
