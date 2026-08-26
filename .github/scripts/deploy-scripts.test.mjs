import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellScripts = [
  'deploy/scripts/_common.sh',
  'deploy/scripts/deploy.sh',
  'deploy/scripts/start.sh',
  'deploy/scripts/rollback.sh',
  'deploy/scripts/health-check.sh',
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
  const currentNodeIndex = dockerfile.indexOf('FROM node:22-alpine3.24 AS node-current');
  const runtimeIndex = dockerfile.indexOf('FROM alpine:3.21 AS runtime');

  assert.ok(currentNodeIndex >= 0, 'current Node 22 image must remain the Node binary source');
  assert.ok(cacheRemovalIndex >= 0, 'Next.js build cache must be removed in the builder stage');
  assert.ok(
    runtimeIndex > cacheRemovalIndex,
    'Next.js build cache must be removed before runtime stage',
  );
  assert.ok(
    runtimeIndex > currentNodeIndex,
    'pinned Alpine runtime must be declared after the current Node source stage',
  );
  assert.match(dockerfile, /COPY --from=node-current \/usr\/local \/usr\/local/u);
  assert.match(dockerfile, /test ! -d apps\/studio\/\.next\/cache/u);
});

test('production app healthchecks do not require curl in the runtime image', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const compose = readFileSync('docker-compose.prod.yml', 'utf8');
  const runtimeIndex = dockerfile.indexOf('FROM alpine:3.21 AS runtime');

  assert.ok(runtimeIndex >= 0, 'production runtime stage must exist');
  assert.doesNotMatch(
    dockerfile.slice(runtimeIndex),
    /apk add --no-cache[^\n]*\bcurl\b/u,
    'production runtime must not install curl',
  );
  assert.doesNotMatch(compose, /\bcurl\b/u, 'production healthchecks must not require curl');
  assert.match(compose, /fetch\('http:\/\/localhost:3001\/api\/v1\/health'\)/u);
  assert.match(compose, /process\.env\.HEALTH_PORT/u);
});

test(
  'production readiness checks remain valid after Authenticated Origin Pulls is enabled',
  () => {
    const common = readFileSync('deploy/scripts/_common.sh', 'utf8');
    const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
    const manualHealth = readFileSync('deploy/scripts/health-check.sh', 'utf8');
    const directDeployScripts = [
      'deploy/scripts/deploy.sh',
      'deploy/scripts/start.sh',
      'deploy/scripts/rollback.sh',
    ];

    assert.match(common, /\$\{COMPOSE\} exec -T api node -e/u);
    assert.match(common, /http:\/\/127\.0\.0\.1:3001\/api\/v1\/health/u);
    assert.match(common, /\$\{COMPOSE\} exec -T studio node -e/u);
    assert.match(common, /http:\/\/127\.0\.0\.1:3000\/api\/auth\/providers/u);
    assert.match(common, /wait_for_edge\(\)/u);
    assert.match(common, /https:\/\/\$\{HEALTH_DOMAIN\}\/api\/v1\/health/u);
    assert.match(common, /https:\/\/\$\{HEALTH_DOMAIN\}\/api\/auth\/providers/u);
    assert.doesNotMatch(common, /--resolve[^\n]*127\.0\.0\.1/u);

    assert.match(workflow, /\n\s+wait_for_health\n/u);
    assert.match(workflow, /\n\s+wait_for_auth\n/u);
    assert.doesNotMatch(
      workflow,
      /--resolve\s+herta\.ivrm\.jp:443:127\.0\.0\.1/u,
    );
    assert.match(workflow, /https:\/\/herta\.ivrm\.jp\/api\/v1\/health/u);
    assert.match(workflow, /https:\/\/herta\.ivrm\.jp\/api\/auth\/providers/u);

    assert.match(manualHealth, /wait_for_health/u);
    assert.match(manualHealth, /wait_for_auth/u);
    assert.match(manualHealth, /wait_for_edge/u);
    assert.doesNotMatch(manualHealth, /--resolve[^\n]*127\.0\.0\.1/u);

    for (const scriptPath of directDeployScripts) {
      const script = readFileSync(scriptPath, 'utf8');
      assert.match(
        script,
        /\nwait_for_edge\n/u,
        `${scriptPath} must verify Cloudflare-facing health before reporting success`,
      );
    }
  },
);

test(
  'rollback keeps AOP-aware edge checks independent from the target revision',
  () => {
    const rollback = readFileSync('deploy/scripts/rollback.sh', 'utf8');
    const sourceIndex = rollback.indexOf(
      'source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"',
    );
    const checkoutIndex = rollback.indexOf('git checkout "${TARGET_SHA}"');
    const edgeIndex = rollback.indexOf('wait_for_edge');

    assert.ok(sourceIndex >= 0, 'rollback must source current deployment helpers');
    assert.ok(
      checkoutIndex > sourceIndex,
      'current helpers must be loaded before checkout',
    );
    assert.ok(
      edgeIndex > checkoutIndex,
      'edge health must run after the target is started',
    );
    assert.doesNotMatch(
      rollback.slice(checkoutIndex),
      /health-check\.sh/u,
      'rollback must not execute a health-check script from the target revision',
    );
  },
);

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