import { readFileSync } from 'node:fs';

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
  const proofs = [...stdout.matchAll(
    /(?:^|\n)(?:out:[ \t]*)?HERTA_RELEASE_PROOF[ \t]+([a-f0-9]{40})[ \t]+(sha256:[a-f0-9]{64})(?:\r?\n|$)/g,
  )];
  if (proofs.length !== 1 || proofs[0][1] !== expectedSha) {
    throw new Error('Missing, duplicate, stale or malformed Lightsail runtime proof');
  }
  return { sha: expectedSha, imageId: proofs[0][2] };
}

export function buildProductionDeploymentPayload({
  runId, runAttempt, sha, imageId, actor,
}) {
  if (
    !Number.isSafeInteger(runId) || runId < 1 ||
    !Number.isSafeInteger(runAttempt) || runAttempt < 1 ||
    !SHA_RE.test(sha) || !IMAGE_ID_RE.test(imageId) ||
    typeof actor !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(actor)
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
  const deployments = [];
  for (const { run, jobs } of runsWithJobs) {
    if (
      !run || run.status !== 'completed' || run.conclusion !== 'success' ||
      !['push', 'workflow_run', 'workflow_dispatch'].includes(run.event) ||
      !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) ||
      !Array.isArray(jobs)
    ) {
      continue;
    }
    const successful = jobs.filter(
      (job) => job.name === 'SSH Deploy to Lightsail' && job.conclusion === 'success',
    );
    if (successful.length > 1) {
      throw new Error('Multiple successful SSH deployment jobs in one workflow run');
    }
    if (successful.length === 1) {
      const job = successful[0];
      const completedMs = Date.parse(job.completed_at ?? '');
      if (!Number.isFinite(completedMs) || job.status !== 'completed') {
        throw new Error('Successful SSH job completion is not verifiable');
      }
      deployments.push({ run, job, completedMs });
    }
  }
  deployments.sort(
    (a, b) => b.completedMs - a.completedMs || b.run.id - a.run.id,
  );
  if (deployments.length > 1 && deployments[0].completedMs === deployments[1].completedMs) {
    throw new Error('Cannot uniquely order concurrent successful production SSH jobs');
  }
  return deployments[0] ?? null;
}

export function validateProductionDeploymentAttestation({ run, job, deployment, statuses }) {
  const payload = deployment?.payload;
  if (
    !run || !job || !deployment || deployment.environment !== RUNTIME_ATTESTATION_ENVIRONMENT ||
    deployment.task !== RUNTIME_ATTESTATION_TASK ||
    !SHA_RE.test(deployment.sha) ||
    !payload || payload.schemaVersion !== 1 ||
    !Number.isSafeInteger(payload.runId) || payload.runId !== run.id ||
    !Number.isSafeInteger(payload.runAttempt) || payload.runAttempt !== run.run_attempt ||
    payload.sha !== deployment.sha ||
    payload.imageRef !== IMAGE_REPOSITORY + ':' + deployment.sha ||
    !IMAGE_ID_RE.test(payload.imageId) ||
    payload.actor !== run.actor?.login ||
    payload.environment !== 'production' ||
    payload.source !== 'lightsail-ssh-container-readback' ||
    !Array.isArray(payload.services) ||
    payload.services.join(',') !== RUNTIME_SERVICES.join(',') ||
    !Array.isArray(statuses) || statuses.length === 0 ||
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
    created < sshStarted || created > sshCompleted ||
    statusCreated < created || statusCreated > sshCompleted
  ) {
    throw new Error('Runtime proof was not issued during the successful SSH deployment job');
  }
  return deployment.sha;
}

export async function loadLatestProductionAttestation(api) {
  const result = await api(
    'actions/workflows/deploy-production.yml/runs?branch=main&status=success&per_page=100',
  );
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
      'deployments?environment=' + RUNTIME_ATTESTATION_ENVIRONMENT +
        '&per_page=100&page=' + page,
    );
    if (!Array.isArray(records)) throw new Error('Invalid production proof pagination');
    matches.push(...records.filter(
      (item) => item.payload?.runId === latest.run.id &&
        item.payload?.runAttempt === latest.run.run_attempt,
    ));
    if (records.length < 100) {
      fullyRead = true;
      break;
    }
  }
  if (!fullyRead || matches.length !== 1) {
    throw new Error('Missing, duplicate or incomplete production provenance record');
  }
  const deployment = matches[0];
  const statusResult = await api(
    'deployments/' + deployment.id + '/statuses?per_page=100',
  );
  const sha = validateProductionDeploymentAttestation({
    run: latest.run, job: latest.job, deployment, statuses: statusResult,
  });
  return { sha, runId: latest.run.id, imageId: deployment.payload.imageId };
}
