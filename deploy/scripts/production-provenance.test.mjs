import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildProductionDeploymentPayload,
  loadLatestProductionAttestation,
  parseProductionRuntimeProof,
  RUNTIME_ATTESTATION_ENVIRONMENT,
  RUNTIME_ATTESTATION_TASK,
  selectLatestSuccessfulSshDeployment,
  validateProductionDeploymentAttestation,
} from './production-provenance.mjs';

import { protectedProofApiError, publishProtectedReleaseProof } from './production-provenance-publish.mjs';
import { inspectProductionProofRecords } from './production-proof-audit.mjs';

test('production proof failures identify the failing POST without logging response data', () => {
  assert.equal(
    protectedProofApiError('create', 500).message,
    'Unable to record protected release proof (deployment create): HTTP 500',
  );
  assert.equal(
    protectedProofApiError('status', 503).message,
    'Unable to record protected release proof (deployment status): HTTP 503',
  );
  assert.equal(
    protectedProofApiError('create', 500, 'ABCD:1234-TEST').message,
    'Unable to record protected release proof (deployment create): HTTP 500 (GitHub request ID: ABCD:1234-TEST)',
  );
  for (const unsafeId of ['bad id', 'fake\\nSECRET', '<injection>', 'A'.repeat(129), '']) {
    assert.equal(
      protectedProofApiError('status', 500, unsafeId).message,
      'Unable to record protected release proof (deployment status): HTTP 500',
    );
  }
  assert.equal(
    protectedProofApiError('status', 500, null).message,
    'Unable to record protected release proof (deployment status): HTTP 500',
  );
  assert.throws(() => protectedProofApiError('unknown', 500), /Invalid protected/);
  assert.throws(() => protectedProofApiError('create', Number.NaN), /Invalid protected/);
});

test('publisher reports failed POST stage and sanitized request ID without retries', async () => {
  const sha = 'a'.repeat(40);
  const env = {
    GITHUB_REPOSITORY: 'ivRooom/Herta',
    GITHUB_TOKEN: 'synthetic-not-a-secret',
    DEPLOY_REF: sha,
    HERTA_IMAGE: 'ghcr.io/ivrooom/herta:' + sha,
    GITHUB_ACTOR: 'test-maintainer',
    GITHUB_RUN_ID: '41807040824',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'deploy',
    HERTA_RUNTIME_READBACK: 'HERTA_RELEASE_PROOF ' + sha + ' sha256:' + 'b'.repeat(64),
  };
  for (const failingStage of ['create', 'status']) {
    const paths = [];
    const fetchImpl = async (url, options) => {
      const path = url.split('/repos/ivRooom/Herta/')[1];
      paths.push(path);
      assert.equal(options.method, 'POST');
      if (failingStage === 'status' && path === 'deployments') {
        return {
          ok: true,
          json: async () => ({ sha, environment: 'herta-runtime-attested', id: 123 }),
        };
      }
      return {
        ok: false,
        status: 500,
        headers: { get: () => 'ABCD:1234-TEST' },
      };
    };
    const phase = failingStage === 'create' ? 'deployment create' : 'deployment status';
    const expected = 'Unable to record protected release proof (' + phase + '): HTTP 500';
    const requestId = ' (GitHub request ID: ABCD:1234-TEST)';
    await assert.rejects(publishProtectedReleaseProof({ env, fetchImpl }), (error) => {
      assert.equal(error.message, expected + requestId);
      return true;
    });
    assert.equal(paths[0], 'deployments');
    assert.equal(paths.length, failingStage === 'create' ? 1 : 2);
    if (failingStage === 'status') {
      assert.equal(paths[1], 'deployments/123/statuses');
    }
  }
});

test('read-only proof audit distinguishes partial and complete states', async () => {
  const sha = 'a'.repeat(40);
  const proof = {
    id: 12,
    sha,
    task: 'deploy:runtime-proof',
    environment: 'herta-runtime-attested',
    payload: { runId: 41807040824, runAttempt: 1 },
  };
  const paths = [];
  const api = async (path) => {
    paths.push(path);
    if (path.startsWith('deployments?')) return [proof];
    if (path === 'deployments/12/statuses?per_page=100') return [];
    throw new Error('Unexpected audit path');
  };
  const input = { sha, runId: 41807040824, runAttempt: 1 };
  assert.deepEqual(await inspectProductionProofRecords(api, input), {
    ...input,
    records: [{ deploymentId: 12, runMatches: true, attemptMatches: true, states: [] }],
  });
  assert.ok(paths.every((path) => path.startsWith('deployments')));
  assert.deepEqual((await inspectProductionProofRecords(async () => [], input)).records, []);

  const completeApi = async (path) => {
    if (path.startsWith('deployments?')) return [proof];
    return [{ state: 'success' }];
  };
  const complete = await inspectProductionProofRecords(completeApi, input);
  assert.deepEqual(complete.records[0].states, ['success']);
});

test('read-only proof audit refuses truncated histories and invalid states', async () => {
  const sha = 'a'.repeat(40);
  const input = { sha, runId: 1, runAttempt: 1 };
  const sample = {
    id: 42,
    sha,
    task: 'deploy:runtime-proof',
    environment: 'herta-runtime-attested',
  };
  await assert.rejects(inspectProductionProofRecords(async () => [], { ...input, sha: 'main' }));
  await assert.rejects(inspectProductionProofRecords(async () => [], { ...input, runId: 0 }));

  const missingPage = async () => Array.from({ length: 100 }, () => sample);
  await assert.rejects(
    inspectProductionProofRecords(missingPage, input),
    /Incomplete GitHub deployment history/,
  );
  const missingStatuses = async (path) => {
    if (path.startsWith('deployments?')) return [sample];
    return Array.from({ length: 100 }, () => ({ state: 'success' }));
  };
  await assert.rejects(
    inspectProductionProofRecords(missingStatuses, input),
    /Incomplete GitHub deployment status history/,
  );
  const invalidStatus = async (path) => {
    if (path.startsWith('deployments?')) return [sample];
    return [{ state: 'unexpected' }];
  };
  await assert.rejects(
    inspectProductionProofRecords(invalidStatus, input),
    /Invalid GitHub deployment status/,
  );
});

const sha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const imageId = 'sha256:' + 'c'.repeat(64);
const actor = 'mizzz-ivr';

const manualRun = {
  id: 241,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  event: 'workflow_dispatch',
  head_sha: oldSha, // GitHub dispatch HEAD is NOT the actual rollback target.
  actor: { login: actor },
};
const sshJob = {
  name: 'SSH Deploy to Lightsail',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-03T10:00:00Z',
  completed_at: '2026-11-03T10:03:00Z',
  steps: [{ name: 'LightsailへSSHデプロイ', status: 'completed', conclusion: 'success' }],
};
const payload = buildProductionDeploymentPayload({
  runId: manualRun.id,
  runAttempt: manualRun.run_attempt,
  sha,
  imageId,
  actor,
});
const record = {
  id: 9001,
  environment: RUNTIME_ATTESTATION_ENVIRONMENT,
  task: RUNTIME_ATTESTATION_TASK,
  sha,
  created_at: '2026-11-03T10:02:00Z',
  payload,
};
const status = {
  state: 'success',
  created_at: '2026-11-03T10:02:30Z',
};

test('trusted GitHub bot actors are accepted without widening arbitrary login values', () => {
  const bot = buildProductionDeploymentPayload({
    runId: 241,
    runAttempt: 1,
    sha,
    imageId,
    actor: 'github-merge-queue[bot]',
  });
  assert.equal(bot.actor, 'github-merge-queue[bot]');
  assert.throws(() =>
    buildProductionDeploymentPayload({
      runId: 241,
      runAttempt: 1,
      sha,
      imageId,
      actor: 'github-merge-queue[bot]extra',
    }),
  );
});

test('only a unique exact remote image SHA and config digest becomes provenance', () => {
  assert.deepEqual(
    parseProductionRuntimeProof('out: HERTA_RELEASE_PROOF ' + sha + ' ' + imageId + '\n', sha),
    { sha, imageId },
  );
  for (const raw of [
    '',
    'out: HERTA_RELEASE_PROOF ' + oldSha + ' ' + imageId,
    'out: HERTA_RELEASE_PROOF ' + sha + ' sha256:broken',
    'out: HERTA_RELEASE_PROOF ' +
      sha +
      ' ' +
      imageId +
      '\n' +
      'out: HERTA_RELEASE_PROOF ' +
      sha +
      ' ' +
      imageId,
  ]) {
    assert.throws(() => parseProductionRuntimeProof(raw, sha), /proof/);
  }
  assert.throws(() =>
    buildProductionDeploymentPayload({
      runId: 3,
      runAttempt: 1,
      sha,
      imageId: 'not-a-digest',
      actor,
    }),
  );
});

test('accepts GitHub bot actor logins without admitting arbitrary suffixes', () => {
  const makePayload = (actorLogin) =>
    buildProductionDeploymentPayload({
      runId: 11,
      runAttempt: 1,
      sha,
      imageId,
      actor: actorLogin,
    });
  for (const actorLogin of ['mizzz-ivr', 'dependabot[bot]', 'github-merge-queue[bot]']) {
    assert.equal(makePayload(actorLogin).actor, actorLogin);
  }
  for (const actorLogin of [
    '',
    'dependabot[admin]',
    'github/actions[bot]',
    'bot[Bot]',
    'a'.repeat(40),
  ]) {
    assert.throws(() => makePayload(actorLogin), /Unverifiable production provenance input/);
  }
});

test('manual rollback attestation uses verified runtime SHA, not dispatch head SHA', () => {
  assert.equal(manualRun.head_sha, oldSha);
  assert.equal(
    validateProductionDeploymentAttestation({
      run: manualRun,
      job: sshJob,
      deployment: record,
      statuses: [status],
    }),
    sha,
  );
});

test('rejects forged source, actor, image, stale SHA, missing status, tampered dates and services', () => {
  for (const deployment of [
    { ...record, sha: oldSha },
    { ...record, environment: 'production' },
    { ...record, payload: { ...payload, imageId: 'invalid' } },
    { ...record, payload: { ...payload, actor: 'intruder' } },
    { ...record, payload: { ...payload, runId: 240 } },
    { ...record, payload: { ...payload, runAttempt: 2 } },
    { ...record, payload: { ...payload, services: ['api', 'bot'] } },
    { ...record, payload: { ...payload, source: 'guessed-main-sha' } },
    { ...record, created_at: '2026-11-03T09:59:59Z' },
    { ...record, created_at: '2026-11-03T10:03:01Z' },
  ]) {
    assert.throws(() =>
      validateProductionDeploymentAttestation({
        run: manualRun,
        job: sshJob,
        deployment,
        statuses: [status],
      }),
    );
  }
  for (const statuses of [
    [],
    [{ ...status, state: 'failure' }],
    [{ ...status, state: 'inactive' }],
    [{ ...status, created_at: '2026-11-03T09:59:59Z' }],
    [{ ...status, created_at: '2026-11-03T10:03:01Z' }],
  ]) {
    assert.throws(() =>
      validateProductionDeploymentAttestation({
        run: manualRun,
        job: sshJob,
        deployment: record,
        statuses,
      }),
    );
  }
});

test('last SSH attempt wins; a failed post-SSH health check blocks older proof', () => {
  const old = {
    run: { ...manualRun, id: 100, event: 'workflow_run' },
    jobs: [{ ...sshJob, completed_at: '2026-11-03T09:50:00Z' }],
  };
  const failedAfterSsh = {
    run: { ...manualRun, id: 300, conclusion: 'failure' },
    jobs: [
      {
        ...sshJob,
        conclusion: 'failure',
        completed_at: '2026-11-03T10:05:00Z',
      },
    ],
  };
  const noop = {
    run: { ...manualRun, id: 320 },
    jobs: [{ name: 'Verified main CI gate', conclusion: 'success' }],
  };
  assert.equal(
    selectLatestSuccessfulSshDeployment([old, { run: manualRun, jobs: [sshJob] }, noop]).run.id,
    manualRun.id,
  );
  assert.throws(
    () =>
      selectLatestSuccessfulSshDeployment([
        old,
        { run: manualRun, jobs: [sshJob] },
        failedAfterSsh,
      ]),
    /Latest production SSH attempt failed/,
  );
  const failedWithinSsh = {
    run: { ...manualRun, id: 330, conclusion: 'failure' },
    jobs: [
      {
        ...sshJob,
        conclusion: 'failure',
        completed_at: '2026-11-03T10:09:00Z',
        steps: [{ name: 'LightsailへSSHデプロイ', status: 'completed', conclusion: 'failure' }],
      },
    ],
  };
  assert.throws(
    () => selectLatestSuccessfulSshDeployment([old, failedWithinSsh]),
    /Latest production SSH attempt failed/,
  );
  assert.equal(selectLatestSuccessfulSshDeployment([noop]), null);
  assert.throws(() =>
    selectLatestSuccessfulSshDeployment([{ run: manualRun, jobs: [sshJob, sshJob] }]),
  );
  assert.throws(
    () =>
      selectLatestSuccessfulSshDeployment([
        { run: manualRun, jobs: [sshJob] },
        { run: { ...manualRun, id: 300 }, jobs: [sshJob] },
      ]),
    /uniquely order/,
  );
});

function apiFixture({
  deployments = [record],
  statuses = [status],
  jobs = [sshJob],
  runs = [manualRun],
  otherPage = [],
  totalCount = jobs.length,
} = {}) {
  return async (path) => {
    if (path.startsWith('actions/workflows/')) return { workflow_runs: runs };
    if (path.includes('/jobs?')) return { jobs, total_count: totalCount };
    if (path.startsWith('deployments?')) {
      return path.includes('page=1') ? deployments : otherPage;
    }
    if (path.startsWith('deployments/')) return statuses;
    throw new Error('Unexpected GitHub endpoint: ' + path);
  };
}

test('automatic main CI can safely no-op against the actual manual deployed SHA', async () => {
  const proof = await loadLatestProductionAttestation(apiFixture());
  assert.deepEqual(proof, { sha, runId: manualRun.id, imageId });
});

test('manual bootstrap cannot miss an SSH baseline hidden beyond 100 no-op runs', async () => {
  const noOpRuns = Array.from({ length: 100 }, (_, i) => ({
    ...manualRun,
    id: 1000 + i,
    event: 'workflow_run',
  }));
  const api = async (path) => {
    if (path.startsWith('actions/workflows/')) {
      return {
        workflow_runs: path.endsWith('page=1') ? noOpRuns : [manualRun],
        total_count: 101,
      };
    }
    if (path.includes('/jobs?')) {
      const isSshRun = path.includes('/runs/' + manualRun.id + '/jobs?');
      return {
        jobs: isSshRun ? [sshJob] : [{ name: 'Verified main CI gate', steps: [] }],
        total_count: 1,
      };
    }
    if (path.startsWith('deployments?')) return path.includes('page=1') ? [record] : [];
    if (path.startsWith('deployments/')) return [status];
    throw new Error('Unexpected fixture API path');
  };
  assert.deepEqual(await loadLatestProductionAttestation(api), {
    sha,
    runId: manualRun.id,
    imageId,
  });
});

test('manual bootstrap fails closed on truncated or inconsistent workflow history', async () => {
  const noOpRuns = Array.from({ length: 100 }, (_, i) => ({
    ...manualRun,
    id: 3000 + i,
    event: 'workflow_run',
  }));
  const incompleteApi = async (path) => {
    if (path.startsWith('actions/workflows/')) {
      return { workflow_runs: noOpRuns, total_count: 2000 };
    }
    if (path.includes('/jobs?')) {
      return { jobs: [{ name: 'Verified main CI gate', steps: [] }], total_count: 1 };
    }
    throw new Error('Unexpected fixture API path');
  };
  await assert.rejects(
    loadLatestProductionAttestation(incompleteApi),
    /Incomplete production workflow run history/,
  );
  const mismatchedCountApi = async (path) => {
    if (path.startsWith('actions/workflows/')) {
      return { workflow_runs: [], total_count: 1 };
    }
    throw new Error('Unexpected fixture API path');
  };
  await assert.rejects(
    loadLatestProductionAttestation(mismatchedCountApi),
    /Incomplete production workflow run history/,
  );
});

test('automatic gate refuses missing, conflicting, incomplete or failed proof', async () => {
  for (const api of [
    apiFixture({ deployments: [] }),
    apiFixture({ deployments: [record, { ...record, id: 9002 }] }),
    apiFixture({ statuses: [{ ...status, state: 'failure' }] }),
    apiFixture({ totalCount: 4 }),
    apiFixture({ runs: [{ ...manualRun, conclusion: 'failure' }] }),
  ]) {
    await assert.rejects(loadLatestProductionAttestation(api));
  }
});

test('release workflow protects proof publisher behind SSH and Cloudflare health', () => {
  const source = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const deploy = source.split('\n  deploy:\n')[1];
  assert.ok(deploy.includes('environment: production'));
  assert.ok(deploy.includes('deployments: write'));
  assert.ok(deploy.includes('ref: ${{ github.sha }}'));
  assert.ok(source.includes('deployments: read'));
  const first = deploy.indexOf('      - name: LightsailへSSHデプロイ');
  const external = deploy.indexOf('      - name: Cloudflare経由の外部Health check');
  const readback = deploy.indexOf('      - name: Read back running API/Bot/Studio/Worker');
  const publish = deploy.indexOf('      - name: Publish verified production runtime attestation');
  assert.ok(first >= 0 && first < external && external < readback && readback < publish);
  assert.ok(deploy.includes('capture_stdout: true'));
  // Both the mutating deploy SSH and the later read-only proof SSH must
  // verify the same independently established host identity.
  const pin = 'fingerprint: ${{ vars.LIGHTSAIL_SSH_FINGERPRINT }}';
  assert.equal(deploy.split(pin).length - 1, 2);
  const hostKeyGuard = deploy.indexOf(
    '      - name: Verify pinned Lightsail SSH host key before accessing production',
  );
  const credentials = deploy.indexOf('      - name: AWS credentialsを設定');
  assert.ok(hostKeyGuard >= 0 && hostKeyGuard < credentials && credentials < first);
  assert.ok(deploy.includes('^SHA256:[A-Za-z0-9+/]{43}$'));
  assert.ok(deploy.includes("docker inspect --format '{{.Config.Image}}'"));
  assert.ok(deploy.includes("docker inspect --format '{{.Image}}'"));
  assert.ok(deploy.includes('node deploy/scripts/production-provenance-publish.mjs'));
});
