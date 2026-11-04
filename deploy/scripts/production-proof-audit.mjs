import { RUNTIME_ATTESTATION_ENVIRONMENT, RUNTIME_ATTESTATION_TASK } from './production-provenance.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;

/**
 * Read-only investigation of partial GitHub Deployment proof publication.
 * This is NOT a release attestation or a recovery tool: never write a status
 * based solely on these records, or assume a failed workflow was successful.
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
    const records = await api(
      'deployments?environment=' +
        RUNTIME_ATTESTATION_ENVIRONMENT +
        '&per_page=100&page=' +
        page,
    );
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
    records.push({
      deploymentId: record.id,
      runMatches: record.payload?.runId === runId,
      attemptMatches: record.payload?.runAttempt === runAttempt,
      states: statuses.map((status) => {
        if (!['error', 'failure', 'inactive', 'in_progress', 'pending', 'queued', 'success'].includes(status?.state)) {
          throw new Error('Invalid GitHub deployment status');
        }
        return status.state;
      }),
    });
  }
  return { sha, runId, runAttempt, records };
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
    if (!response.ok) throw new Error('Read-only GitHub proof audit GET failed: HTTP ' + response.status);
    return response.json();
  };
  const result = await inspectProductionProofRecords(api, { sha, runId, runAttempt });
  console.log('READ_ONLY_PROOF_AUDIT ' + JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown read-only proof audit error');
    process.exitCode = 1;
  });
}
