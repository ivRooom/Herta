import {
  buildProductionDeploymentPayload,
  parseProductionRuntimeProof,
  RUNTIME_ATTESTATION_ENVIRONMENT,
  RUNTIME_ATTESTATION_TASK,
} from './production-provenance.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;

/**
 * Keep diagnostics useful without logging GitHub response bodies, deployment
 * payloads or credentials. A 5xx can leave a partial deployment record, so do
 * not blindly retry either POST and risk creating duplicate runtime proofs.
 */
export function protectedProofApiError(stage, status) {
  if (!['create', 'status'].includes(stage) || !Number.isInteger(status)) {
    throw new Error('Invalid protected release proof diagnostic');
  }
  return new Error(
    'Unable to record protected release proof (' +
      (stage === 'create' ? 'deployment create' : 'deployment status') +
      '): HTTP ' +
      status,
  );
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.DEPLOY_REF;
  const ref = process.env.HERTA_IMAGE;
  const actor = process.env.GITHUB_ACTOR;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (
    !repository ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !token ||
    !SHA_RE.test(sha) ||
    ref !== 'ghcr.io/ivrooom/herta:' + sha ||
    process.env.GITHUB_JOB !== 'deploy'
  ) {
    throw new Error('Invalid protected production deployment environment');
  }
  const runtime = parseProductionRuntimeProof(process.env.HERTA_RUNTIME_READBACK ?? '', sha);
  const payload = buildProductionDeploymentPayload({
    runId,
    runAttempt,
    sha,
    imageId: runtime.imageId,
    actor,
  });
  const api = async (path, body, stage) => {
    const response = await fetch('https://api.github.com/repos/' + repository + '/' + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw protectedProofApiError(stage, response.status);
    return response.json();
  };
  // No deployment record is created until SSH runtime readback AND Cloudflare
  // health passed. The required SHA has already passed same-SHA main CI.
  const record = await api('deployments', {
    ref: sha,
    task: RUNTIME_ATTESTATION_TASK,
    environment: RUNTIME_ATTESTATION_ENVIRONMENT,
    description: 'Herta protected runtime release proof (not a deployment trigger)',
    auto_merge: false,
    required_contexts: [],
    transient_environment: false,
    production_environment: true,
    payload,
  }, 'create');
  if (
    record.sha !== sha ||
    record.environment !== RUNTIME_ATTESTATION_ENVIRONMENT ||
    !Number.isSafeInteger(record.id)
  ) {
    throw new Error('Deployment proof record does not match pinned production SHA');
  }
  const published = await api('deployments/' + record.id + '/statuses', {
    state: 'success',
    description: 'Protected SSH runtime digest and Cloudflare health verified',
    log_url: 'https://github.com/' + repository + '/actions/runs/' + runId,
    auto_inactive: false,
  }, 'status');
  if (published.state !== 'success') {
    throw new Error('Deployment proof status was not accepted as successful');
  }
  console.log('Verified Lightsail release proof recorded for ' + sha + ' as ' + record.id);
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown release proof error');
    process.exitCode = 1;
  });
}
