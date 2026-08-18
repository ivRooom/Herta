import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellScripts = [
  'deploy/scripts/_common.sh',
  'deploy/scripts/deploy.sh',
  'deploy/scripts/start.sh',
  'deploy/scripts/rollback.sh',
  'deploy/scripts/deploy-common.test.sh',
];

test('production deploy shell scripts have valid bash syntax', () => {
  execFileSync('bash', ['-n', ...shellScripts], { stdio: 'pipe' });
});

test('bot readiness uses Docker health instead of a recent login log', () => {
  const output = execFileSync('bash', ['deploy/scripts/deploy-common.test.sh'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /deploy common tests passed/u);
});

test('production workflow installs failure diagnostics after checkout', () => {
  const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  const sourceIndex = workflow.indexOf('source deploy/scripts/_common.sh');
  const trapIndex = workflow.indexOf('install_deploy_exit_trap');
  const composeUpIndex = workflow.indexOf('${COMPOSE} up -d --no-build --remove-orphans');
  const clearIndex = workflow.indexOf('clear_deploy_exit_trap');

  assert.ok(sourceIndex >= 0, 'deploy workflow must source the shared deployment helpers');
  assert.ok(trapIndex > sourceIndex, 'diagnostic trap must be installed after sourcing helpers');
  assert.ok(composeUpIndex > trapIndex, 'diagnostic trap must be active before docker compose up');
  assert.ok(
    clearIndex > composeUpIndex,
    'diagnostic trap must only be cleared after deployment checks',
  );
});

test('production deploy reclaims safe Docker space before pulling the next image', () => {
  const common = readFileSync('deploy/scripts/_common.sh', 'utf8');
  const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  const reclaimStart = common.indexOf('reclaim_production_docker_space() {');
  const pullStart = common.indexOf('pull_production_images() {');
  const pullEnd = common.indexOf('\n}\n\nverify_app_image()', pullStart);

  assert.ok(reclaimStart >= 0, 'Docker reclamation helper must exist');
  assert.ok(
    pullStart > reclaimStart,
    'image pull helper must be declared after reclamation helper',
  );
  assert.ok(pullEnd > pullStart, 'image pull helper must have an end');

  const reclaim = common.slice(reclaimStart, pullStart);
  const pull = common.slice(pullStart, pullEnd);

  assert.match(reclaim, /docker image ls "\$\{IMAGE_REPOSITORY\}"/u);
  assert.match(reclaim, /docker image prune -f/u);
  assert.match(reclaim, /docker builder prune -f/u);
  assert.doesNotMatch(reclaim, /docker\s+volume\s+prune/u);
  assert.doesNotMatch(reclaim, /docker\s+system\s+prune/u);
  assert.match(pull, /reclaim_production_docker_space/u);
  assert.match(pull, /\$\{COMPOSE\} pull postgres redis nginx caddy api/u);
  assert.match(workflow, /\n\s+pull_production_images\n/u);
});

test('runtime image excludes the Next.js webpack build cache', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const cacheRemovalIndex = dockerfile.indexOf('apps/studio/.next/cache');
  const runtimeIndex = dockerfile.indexOf('FROM node:22-alpine AS runtime');

  assert.ok(cacheRemovalIndex >= 0, 'Next.js build cache must be removed in the builder stage');
  assert.ok(
    runtimeIndex > cacheRemovalIndex,
    'Next.js build cache must be removed before runtime stage',
  );
  assert.match(dockerfile, /test ! -d apps\/studio\/\.next\/cache/u);
});

test('failure diagnostics do not print production environment values', () => {
  const common = readFileSync('deploy/scripts/_common.sh', 'utf8');
  const startMarker = 'print_deploy_diagnostics() (';
  const endMarker = '\n)\n\n_deploy_exit_handler()';
  const diagnosticsStart = common.indexOf(startMarker);
  const diagnosticsEnd = common.indexOf(endMarker, diagnosticsStart);

  assert.ok(diagnosticsStart >= 0, 'deploy diagnostics function must exist');
  assert.ok(diagnosticsEnd > diagnosticsStart, 'deploy diagnostics function must have an end');

  const diagnostics = common.slice(diagnosticsStart, diagnosticsEnd);

  assert.doesNotMatch(diagnostics, /\bcat\b[^\n]*(?:ENV_FILE|\.env\.production)/u);
  assert.doesNotMatch(diagnostics, /(^|[;&|]\s*)env(?:\s|$)/mu);
  assert.doesNotMatch(diagnostics, /\bprintenv\b/u);
  assert.match(diagnostics, /print_migration_history/u);
  assert.match(diagnostics, /container runtime states/u);
});
