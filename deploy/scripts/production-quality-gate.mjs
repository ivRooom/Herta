import { appendFileSync } from 'node:fs';

const SHA_RE = /^[a-f0-9]{40}$/;
const REQUIRED_WORKFLOWS = [
  { file: 'ci.yml', name: 'CI' },
  { file: 'database-topology.yml', name: 'Database topology contracts' },
];
const PG_WORKFLOW = { file: 'valorant-agents.yml', name: 'VALORANT PostgreSQL integration' };
const PG_PATHS = [
  /^packages\/db\//,
  /^apps\/bot\//,
  /^apps\/studio\//,
  /^\.github\/workflows\/valorant-agents\.yml$/,
];

export function needsPostgresIntegration(files) {
  return files.some((file) => PG_PATHS.some((pattern) => pattern.test(file)));
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
    !['push', 'workflow_dispatch'].includes(event)
  ) {
    throw new Error('Invalid GitHub Actions environment for the production quality gate');
  }
  validateDeployRef(requestedRef);

  const api = async (path) => {
    const response = await fetch('https://api.github.com/repos/' + repository + '/' + path, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok)
      throw new Error('GitHub Actions metadata request failed: HTTP ' + response.status);
    return response.json();
  };
  const currentMain = async () => (await api('branches/main')).commit.sha;
  const triggeredSha = process.env.GITHUB_SHA;
  const mainSha = await currentMain();
  const sha = requestedRef === 'main' ? (event === 'push' ? triggeredSha : mainSha) : requestedRef;
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

  let before = process.env.DEPLOY_PUSH_BEFORE;
  if (event === 'workflow_dispatch') {
    const commit = await api('commits/' + sha);
    before = commit.parents?.[0]?.sha;
  }
  if (!SHA_RE.test(before) || before === sha) {
    throw new Error('Cannot establish production change boundary');
  }
  const files = assertSafeCompare(await api('compare/' + before + '...' + sha));
  const required = [...REQUIRED_WORKFLOWS];
  if (needsPostgresIntegration(files)) required.push(PG_WORKFLOW);
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
  appendFileSync(process.env.GITHUB_OUTPUT, 'deploy_sha=' + sha + '\n');
  console.log('Production quality checks passed for ' + sha.slice(0, 12));
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown quality gate error');
    process.exitCode = 1;
  });
}
