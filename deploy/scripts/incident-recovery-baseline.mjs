import { appendFileSync } from 'node:fs';
import { parseProductionRuntimeProof } from './production-provenance.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;

export function validateProtectedIncidentReadback({ expectedSha, stdout, eventName, jobName }) {
  if (
    eventName !== 'workflow_dispatch' ||
    jobName !== 'incident_baseline' ||
    !SHA_RE.test(expectedSha ?? '')
  ) {
    throw new Error('Untrusted protected incident recovery context');
  }
  return parseProductionRuntimeProof(stdout, expectedSha);
}

async function main() {
  const result = validateProtectedIncidentReadback({
    expectedSha: process.env.EXPECTED_LIVE_SHA,
    stdout: process.env.HERTA_RUNTIME_READBACK ?? '',
    eventName: process.env.GITHUB_EVENT_NAME,
    jobName: process.env.GITHUB_JOB,
  });
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error('Missing authenticated GitHub job output file');
  }
  // The image digest is verified but deliberately not exported across jobs.
  appendFileSync(process.env.GITHUB_OUTPUT, 'live_sha=' + result.sha + '\n');
  console.log('Four-service production readback matched the explicit runtime SHA');
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Invalid protected recovery proof');
    process.exitCode = 1;
  });
}
