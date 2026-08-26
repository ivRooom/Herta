import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routePath = 'src/app/api/admin/runtime-secrets/openai/route.ts';
const settingsPath = 'src/components/ai-provider-credential-settings.tsx';
const semanticRoutePath = 'src/app/api/search/semantic/route.ts';

test('OpenAI credential mutation remains platform-admin and same-origin protected', () => {
  const route = readFileSync(routePath, 'utf8');

  assert.match(route, /isStudioPlatformAdmin/u);
  assert.match(route, /isSameOriginMutationRequest/u);
  assert.match(route, /readRequestBodyBytes\(request, MAX_REQUEST_BODY_BYTES\)/u);
  assert.match(route, /'Cache-Control': 'no-store'/u);
  assert.match(route, /environmentFallbackConfigured: hasOpenAiEnvironmentFallback\(\)/u);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*apiKey/u);
});

test('Studio credential UI is write-only, authorization-gated, and explicit about migration fallback', () => {
  const settings = readFileSync(settingsPath, 'utf8');

  assert.match(settings, /type="password"/u);
  assert.match(settings, /保存済みキーは再表示しません/u);
  assert.match(
    settings,
    /if \(loadState === 'loading' \|\| loadState === 'hidden'\) return null;/u,
  );
  assert.match(settings, /OPENAI_API_KEY migration fallbackが構成されています/u);
  assert.match(settings, /この操作だけではAIアクセス停止を保証しません/u);
  assert.match(settings, /store障害・master key異常時はfail closed/u);
  assert.doesNotMatch(settings, /AIアクセスは停止しません/u);
  assert.doesNotMatch(settings, /setApiKey\([^)]*status/u);
  assert.doesNotMatch(settings, /value=\{status\./u);
});

test('Semantic Search prefers encrypted runtime credential and fails closed on store errors', () => {
  const route = readFileSync(semanticRoutePath, 'utf8');
  const runtimeIndex = route.indexOf('readRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET)');
  const envIndex = route.indexOf('process.env.OPENAI_API_KEY?.trim() || null');

  assert.ok(runtimeIndex >= 0, 'runtime secret resolver must be used');
  assert.ok(envIndex > runtimeIndex, 'OPENAI_API_KEY must remain fallback-only');
  assert.match(route, /error instanceof RuntimeSecretError/u);
  assert.match(route, /credential store is unavailable; failing closed/u);
  assert.doesNotMatch(route, /credential store is unavailable; env fallback remains active/u);
});
