import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const shellScripts = [
  'deploy/scripts/_common.sh',
  'deploy/scripts/deploy.sh',
  'deploy/scripts/start.sh',
  'deploy/scripts/rollback.sh',
  'deploy/scripts/health-check.sh',
  'deploy/scripts/deploy-common.test.sh',
];

test('workflow pre-checkout guard does not leak topology helpers into legacy deployment', () => {
  const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  const start = workflow.indexOf('if [[ -f deploy/scripts/_database-mode.sh ]]; then');
  const end = workflow.indexOf('git checkout --detach "$TARGET_SHA"', start);
  assert.ok(start >= 0 && end > start);
  const guard = workflow.slice(start, end);
  const fixture = mkdtempSync(join(tmpdir(), 'herta-legacy-guard-'));
  try {
    const file = join(fixture, 'env');
    writeFileSync(file, 'COMPOSE_PROJECT_NAME=herta\n');
    const env = {
      ...process.env,
      ENV_FILE: file,
      TARGET_SHA: '1941b7e7862eb405ed44e0cc627b010a4eb1e48b',
    };
    execFileSync(
      'bash',
      ['-ec', `${guard}\nif declare -F start_production_services >/dev/null; then exit 1; fi`],
      { env },
    );
    writeFileSync(file, 'HERTA_DATABASE_MODE=external\n');
    assert.throws(() => execFileSync('bash', ['-ec', guard], { env, stdio: 'pipe' }), {
      status: 2,
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

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
  const sourceImage = dockerfile.match(
    /^FROM node:22\.(\d+)\.(\d+)-alpine3\.24@sha256:[a-f0-9]{64} AS node-current$/mu,
  );
  const currentNodeIndex = sourceImage?.index ?? -1;
  assert.ok(
    sourceImage &&
      (Number(sourceImage[1]) > 23 ||
        (Number(sourceImage[1]) === 23 && Number(sourceImage[2]) >= 4)),
    'Node source image must be at least patched 22.23.4 and pinned by digest',
  );
  const runtimeIndex = dockerfile.indexOf('FROM alpine:3.21 AS runtime');

  assert.ok(currentNodeIndex >= 0, 'reviewed Node 22 image must remain the binary source');
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
  const compose = readFileSync('docker-compose.common.yml', 'utf8');
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

test('production readiness checks remain valid after Authenticated Origin Pulls is enabled', () => {
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
  assert.match(common, /--connect-timeout 5 --max-time 15/u);
  assert.match(common, /--retry 3 --retry-delay 2 --retry-max-time 60 --retry-all-errors/u);
  assert.match(common, /https:\/\/\$\{HEALTH_DOMAIN\}\/api\/v1\/health/u);
  assert.match(common, /https:\/\/\$\{HEALTH_DOMAIN\}\/api\/auth\/providers/u);
  assert.doesNotMatch(common, /--resolve[^\n]*127\.0\.0\.1/u);

  const workflowSourceIndex = workflow.indexOf('source deploy/scripts/_common.sh');
  const workflowHealthIndex = workflow.indexOf('wait_for_health() {', workflowSourceIndex);
  const workflowAuthIndex = workflow.indexOf('wait_for_auth() {', workflowSourceIndex);
  assert.ok(workflowSourceIndex >= 0, 'workflow must load target deployment helpers');
  assert.ok(
    workflowHealthIndex > workflowSourceIndex,
    'workflow must override target API readiness with the AOP-safe check',
  );
  assert.ok(
    workflowAuthIndex > workflowHealthIndex,
    'workflow must override target auth readiness with the AOP-safe check',
  );
  assert.match(workflow, /http:\/\/127\.0\.0\.1:3001\/api\/v1\/health/u);
  assert.match(workflow, /http:\/\/127\.0\.0\.1:3000\/api\/auth\/providers/u);
  assert.match(workflow, /\n\s+wait_for_health\n/u);
  assert.match(workflow, /\n\s+wait_for_auth\n/u);
  assert.doesNotMatch(workflow, /--resolve\s+herta\.ivrm\.jp:443:127\.0\.0\.1/u);
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
});

test('manual deploy uses an absolute helper path and only falls back for legacy targets', () => {
  const deploy = readFileSync('deploy/scripts/deploy.sh', 'utf8');
  const scriptDirIndex = deploy.indexOf(
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
  );
  const initialSourceIndex = deploy.indexOf('source "${SCRIPT_DIR}/_common.sh"');
  const preserveHealthIndex = deploy.indexOf(
    'AOP_WAIT_FOR_HEALTH_DEF="$(declare -f wait_for_health)"',
  );
  const checkoutIndex = deploy.indexOf('git checkout "$TARGET_SHA"');
  const fetchIndex = deploy.indexOf('git fetch --prune --tags origin');
  const targetGuardIndex = deploy.indexOf('assert_database_target "$TARGET_SHA"');
  const unsetIndex = deploy.indexOf('unset -f wait_for_health wait_for_auth wait_for_edge');
  const reloadIndex = deploy.indexOf(
    'source "${SCRIPT_DIR}/_common.sh"',
    initialSourceIndex + 'source "${SCRIPT_DIR}/_common.sh"'.length,
  );
  const fallbackConditionIndex = deploy.indexOf('if ! declare -F wait_for_health >/dev/null');
  const restoreHealthIndex = deploy.indexOf('eval "${AOP_WAIT_FOR_HEALTH_DEF}"');
  const conditionEndIndex = deploy.indexOf('\nfi\n', fallbackConditionIndex);
  const healthIndex = deploy.indexOf('\nwait_for_health\n');

  assert.ok(
    scriptDirIndex >= 0,
    'deploy must capture an absolute script directory before sourcing',
  );
  assert.ok(
    initialSourceIndex > scriptDirIndex,
    'bootstrap helper source must use the absolute path',
  );
  assert.ok(
    preserveHealthIndex > initialSourceIndex,
    'deploy must preserve current AOP-aware helpers before changing refs',
  );
  assert.ok(checkoutIndex > preserveHealthIndex, 'deploy must preserve helpers before checkout');
  assert.ok(fetchIndex > preserveHealthIndex, 'deploy must fetch before resolving target');
  assert.ok(
    targetGuardIndex > fetchIndex && targetGuardIndex < checkoutIndex,
    'target compatibility must be checked before checkout',
  );
  assert.doesNotMatch(deploy, /git pull/u, 'a later pull must not move past the validated target');
  assert.ok(
    unsetIndex > checkoutIndex,
    'target health functions must be cleared before target helper reload',
  );
  assert.ok(
    reloadIndex > unsetIndex,
    'deploy must reload helpers from the deployment target revision',
  );
  assert.ok(
    fallbackConditionIndex > reloadIndex,
    'legacy fallback detection must happen after loading target helpers',
  );
  assert.ok(
    restoreHealthIndex > fallbackConditionIndex && restoreHealthIndex < conditionEndIndex,
    'preserved helpers must only be restored inside the legacy fallback branch',
  );
  assert.ok(
    healthIndex > conditionEndIndex,
    'readiness checks must run after helper selection completes',
  );
  assert.match(deploy, /! declare -F wait_for_auth >\/dev\/null/u);
  assert.match(deploy, /! declare -F wait_for_edge >\/dev\/null/u);
  assert.match(deploy, /AOP_WAIT_FOR_AUTH_DEF="\$\(declare -f wait_for_auth\)"/u);
  assert.match(deploy, /AOP_WAIT_FOR_EDGE_DEF="\$\(declare -f wait_for_edge\)"/u);
  assert.match(deploy, /eval "\$\{AOP_WAIT_FOR_AUTH_DEF\}"/u);
  assert.match(deploy, /eval "\$\{AOP_WAIT_FOR_EDGE_DEF\}"/u);
  assert.doesNotMatch(
    deploy,
    /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/_common\.sh"/u,
    'helper reload must not depend on a relative BASH_SOURCE path after _common changes cwd',
  );
});

test('rollback keeps AOP-aware edge checks independent from the target revision', () => {
  const rollback = readFileSync('deploy/scripts/rollback.sh', 'utf8');
  const sourceIndex = rollback.indexOf('source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"');
  const checkoutIndex = rollback.indexOf('git checkout "${TARGET_SHA}"');
  const edgeIndex = rollback.indexOf('wait_for_edge');

  assert.ok(sourceIndex >= 0, 'rollback must source current deployment helpers');
  assert.ok(checkoutIndex > sourceIndex, 'current helpers must be loaded before checkout');
  assert.ok(edgeIndex > checkoutIndex, 'edge health must run after the target is started');
  assert.doesNotMatch(
    rollback.slice(checkoutIndex),
    /health-check\.sh/u,
    'rollback must not execute a health-check script from the target revision',
  );
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

test('production deploy injects the runtime secret master key from a GitHub secret and guards it', () => {
  const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');

  // production Environment secret -> job env -> SSH envs -> upsert_env の経路が揃っていること。
  assert.match(workflow, /environment:\s*production/u);
  assert.match(
    workflow,
    /HERTA_RUNTIME_SECRET_KEY:\s*\$\{\{\s*secrets\.HERTA_RUNTIME_SECRET_KEY\s*\}\}/u,
  );
  assert.match(workflow, /envs:[^\n]*HERTA_RUNTIME_SECRET_KEY/u);
  assert.match(workflow, /upsert_env HERTA_RUNTIME_SECRET_KEY "\$\{HERTA_RUNTIME_SECRET_KEY\}"/u);

  // master key はSSMからは取得しない (Spotifyのみ)。
  assert.doesNotMatch(workflow, /fetch_ssm_secret '\/ivrm\/runtime\/herta\/runtime-secret-key'/u);

  const presenceIdx = workflow.indexOf('HERTA_RUNTIME_SECRET_KEYが渡されていません');
  const validateIdx = workflow.indexOf('validate_runtime_secret_key "${HERTA_RUNTIME_SECRET_KEY}"');
  const mismatchIdx = workflow.indexOf(
    '既存の有効な HERTA_RUNTIME_SECRET_KEY と渡された値が一致しません',
  );
  const existingGuardIdx = workflow.indexOf(
    'validate_runtime_secret_key "${existing_runtime_key}"',
  );
  const upsertIdx = workflow.indexOf(
    'upsert_env HERTA_RUNTIME_SECRET_KEY "${HERTA_RUNTIME_SECRET_KEY}"',
  );

  assert.ok(presenceIdx >= 0, 'workflow must fail closed when the master key secret is missing');
  assert.ok(validateIdx >= 0, 'workflow must validate the master key format before writing it');
  assert.ok(
    mismatchIdx >= 0,
    'workflow must abort when an existing valid key differs from the incoming value',
  );
  assert.ok(
    existingGuardIdx >= 0,
    'mismatch guard must only fire when the existing local key is itself valid',
  );
  assert.match(workflow, /strip_surrounding_quotes/u);
  // 等価判定は文字列ではなく decode 後の byte fingerprint で行う。
  assert.match(workflow, /runtime_key_fingerprint "\$\{existing_runtime_key\}"/u);
  assert.match(workflow, /runtime_key_fingerprint "\$\{HERTA_RUNTIME_SECRET_KEY\}"/u);
  assert.ok(
    validateIdx < upsertIdx && mismatchIdx < upsertIdx,
    'format and mismatch guards must run before the environment file is overwritten',
  );
});
