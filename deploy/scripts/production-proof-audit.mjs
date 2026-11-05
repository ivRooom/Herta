import {
  RUNTIME_ATTESTATION_ENVIRONMENT,
  RUNTIME_ATTESTATION_TASK,
} from './production-provenance.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const VALID_STATES = new Set([
  'error',
  'failure',
  'inactive',
  'in_progress',
  'pending',
  'queued',
  'success',
]);

/**
 * Read-only inspection of partial GitHub Deployment proof publication.
 * This is not an attestation or recovery operation. Never infer that a
 * failed workflow succeeded, or mutate remote release status using this data.
 */
export async function inspectProductionProofRecords(api, { sha, runId, runAttempt }) {
  if (
    !SHA_RE.test(sha) ||
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt < 1
  ) {
    throw new Error('Invalid read-only production proof audit input');
  }
  const matches = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const path =
      'deployments?environment=' + RUNTIME_ATTESTATION_ENVIRONMENT + '&per_page=100&page=' + page;
    const records = await api(path);
    if (!Array.isArray(records) || records.length > 100) {
      throw new Error('Invalid GitHub deployment history response');
    }
    for (const record of records) {
      if (
        record?.environment === RUNTIME_ATTESTATION_ENVIRONMENT &&
        record?.task === RUNTIME_ATTESTATION_TASK &&
        record?.sha === sha
      ) {
        if (!Number.isSafeInteger(record.id) || record.id < 1) {
          throw new Error('Invalid GitHub deployment record ID');
        }
        matches.push(record);
      }
    }
    if (records.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error('Incomplete GitHub deployment history: refusing partial audit');
  const records = [];
  for (const record of matches) {
    const statuses = await api('deployments/' + record.id + '/statuses?per_page=100');
    if (!Array.isArray(statuses) || statuses.length >= 100) {
      throw new Error('Incomplete GitHub deployment status history');
    }
    const states = [];
    const statusCreatedAts = [];
    for (const status of statuses) {
      if (!VALID_STATES.has(status?.state)) {
        throw new Error('Invalid GitHub deployment status');
      }
      states.push(status.state);
      statusCreatedAts.push(status.created_at ?? null);
    }
    records.push({
      deploymentId: record.id,
      deploymentCreatedAt: record.created_at ?? null,
      runMatches: record.payload?.runId === runId,
      attemptMatches: record.payload?.runAttempt === runAttempt,
      states,
      statusCreatedAts,
    });
  }
  // A GitHub success status alone cannot prove the SSH job's timing,
  // current host SHA, image identity, health or restore readiness.
  const exact = records.filter((record) => record.runMatches && record.attemptMatches);
  let classification = 'missing';
  if (exact.length > 1) {
    classification = 'ambiguous';
  } else if (exact.length === 1) {
    classification = exact[0].states.length === 0 ? 'partial' : 'status-present-unverified';
  } else if (records.length > 0) {
    classification = 'unmatched';
  }
  return { sha, runId, runAttempt, classification, records };
}

/**
 * Optional incident correlation only. A time match is NOT proof of a
 * successful release: the SSH job can fail after creating the deployment.
 * Read only the exact GitHub Actions run attempt and refuse ambiguous jobs.
 */
export async function inspectProductionProofJobTiming(api, audit) {
  const { runId, runAttempt, records } = audit;
  if (
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt < 1 ||
    !Array.isArray(records)
  ) {
    throw new Error('Invalid read-only SSH timing audit input');
  }
  const result = await api('actions/runs/' + runId + '/attempts/' + runAttempt + '/jobs?per_page=100');
  if (
    !Array.isArray(result?.jobs) ||
    !Number.isSafeInteger(result.total_count) ||
    result.total_count !== result.jobs.length ||
    result.jobs.length > 100
  ) {
    throw new Error('Incomplete GitHub SSH job history');
  }
  const jobs = result.jobs.filter((job) => job?.name === 'SSH Deploy to Lightsail');
  if (jobs.length !== 1) {
    throw new Error('Missing or ambiguous production SSH job');
  }
  const job = jobs[0];
  const validDate = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
  if (
    !validDate(job.started_at) ||
    !validDate(job.completed_at) ||
    Date.parse(job.started_at) > Date.parse(job.completed_at)
  ) {
    throw new Error('Missing or invalid SSH job timestamps');
  }
  return {
    sshJob: {
      startedAt: job.started_at,
      completedAt: job.completed_at,
      conclusion: job.conclusion ?? null,
    },
    deploymentTiming: records.map((record) => {
      if (!validDate(record.deploymentCreatedAt)) {
        return { deploymentId: record.deploymentId, relativeToSshJob: 'unknown' };
      }
      const created = Date.parse(record.deploymentCreatedAt);
      return {
        deploymentId: record.deploymentId,
        relativeToSshJob:
          created >= Date.parse(job.started_at) && created <= Date.parse(job.completed_at)
            ? 'inside'
            : 'outside',
      };
    }),
    releaseVerified: false,
  };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.PROOF_AUDIT_SHA;
  const runId = Number(process.env.PROOF_AUDIT_RUN_ID);
  const runAttempt = Number(process.env.PROOF_AUDIT_RUN_ATTEMPT);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) {
    throw new Error('Missing or invalid GitHub audit environment');
  }
  const api = async (path) => {
    const response = await fetch('https://api.github.com/repos/' + repo + '/' + path, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error('Read-only GitHub proof audit GET failed: HTTP ' + response.status);
    }
    return response.json();
  };
  const result = await inspectProductionProofRecords(api, { sha, runId, runAttempt });
  if (process.env.PROOF_AUDIT_INCLUDE_JOB_TIMING === 'true') {
    result.jobTiming = await inspectProductionProofJobTiming(api, result);
  } else if (
    process.env.PROOF_AUDIT_INCLUDE_JOB_TIMING &&
    process.env.PROOF_AUDIT_INCLUDE_JOB_TIMING !== 'false'
  ) {
    throw new Error('Invalid read-only SSH timing audit option');
  }
  console.log('READ_ONLY_PROOF_AUDIT ' + JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown read-only proof audit error');
    process.exitCode = 1;
  });
}
