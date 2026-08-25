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
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*apiKey/u);
});

test('Studio credential UI is write-only and never asks the API for plaintext', () => {
  const settings = readFileSync(settingsPath, 'utf8');

  assert.match(settings, /type="password"/u);
  assert.match(settings, /保存済みキーは再表示しません/u);
  assert.doesNotMatch(settings, /setApiKey\([^)]*status/u);
  assert.doesNotMatch(settings, /value=\{status\./u);
});

test('Semantic Search prefers encrypted runtime credential before env fallback', () => {
  const route = readFileSync(semanticRoutePath, 'utf8');
  const runtimeIndex = route.indexOf('readRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET)');
  const envIndex = route.indexOf('process.env.OPENAI_API_KEY?.trim() || null');

  assert.ok(runtimeIndex >= 0, 'runtime secret resolver must be used');
  assert.ok(envIndex > runtimeIndex, 'OPENAI_API_KEY must remain fallback-only');
  assert.match(route, /error instanceof RuntimeSecretError/u);
});
