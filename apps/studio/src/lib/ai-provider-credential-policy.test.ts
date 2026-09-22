import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routePath = 'src/app/api/admin/runtime-secrets/openai/route.ts';
const settingsPath = 'src/components/ai-provider-credential-settings.tsx';
const anthropicRoutePath = 'src/app/api/admin/runtime-secrets/anthropic/route.ts';
const anthropicSettingsPath = 'src/components/anthropic-provider-credential-settings.tsx';
const googleRoutePath = 'src/app/api/admin/runtime-secrets/google/route.ts';
const googleSettingsPath = 'src/components/google-provider-credential-settings.tsx';
const moonshotRoutePath = 'src/app/api/admin/runtime-secrets/moonshot/route.ts';
const moonshotSettingsPath = 'src/components/moonshot-provider-credential-settings.tsx';
const semanticRoutePath = 'src/app/api/search/semantic/route.ts';
const runtimeSettingsRoutePath = 'src/app/api/admin/runtime-config/ai/route.ts';

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

test('Anthropic credential mutation remains platform-admin and same-origin protected', () => {
  const route = readFileSync(anthropicRoutePath, 'utf8');

  assert.match(route, /isStudioPlatformAdmin/u);
  assert.match(route, /isSameOriginMutationRequest/u);
  assert.match(route, /readRequestBodyBytes\(request, MAX_REQUEST_BODY_BYTES\)/u);
  assert.match(route, /'Cache-Control': 'no-store'/u);
  assert.match(route, /environmentFallbackConfigured: hasAnthropicEnvironmentFallback\(\)/u);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*apiKey/u);
});

test('Studio Anthropic credential UI is write-only, authorization-gated, and explicit about migration fallback', () => {
  const settings = readFileSync(anthropicSettingsPath, 'utf8');

  assert.match(settings, /type="password"/u);
  assert.match(settings, /保存済みキーは再表示しません/u);
  assert.match(
    settings,
    /if \(loadState === 'loading' \|\| loadState === 'hidden'\) return null;/u,
  );
  assert.match(settings, /ANTHROPIC_API_KEY migration fallbackが構成されています/u);
  assert.match(settings, /この操作だけではAIアクセス停止を保証しません/u);
  assert.match(settings, /store障害・master key異常時はfail closed/u);
  assert.doesNotMatch(settings, /setApiKey\([^)]*status/u);
  assert.doesNotMatch(settings, /value=\{status\./u);
});

test('Google credential mutation remains platform-admin and same-origin protected', () => {
  const route = readFileSync(googleRoutePath, 'utf8');

  assert.match(route, /isStudioPlatformAdmin/u);
  assert.match(route, /isSameOriginMutationRequest/u);
  assert.match(route, /readRequestBodyBytes\(request, MAX_REQUEST_BODY_BYTES\)/u);
  assert.match(route, /'Cache-Control': 'no-store'/u);
  assert.match(route, /environmentFallbackConfigured: hasGoogleEnvironmentFallback\(\)/u);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*apiKey/u);
});

test('Studio Google credential UI is write-only, authorization-gated, and explicit about migration fallback', () => {
  const settings = readFileSync(googleSettingsPath, 'utf8');

  assert.match(settings, /type="password"/u);
  assert.match(settings, /保存済みキーは再表示しません/u);
  assert.match(
    settings,
    /if \(loadState === 'loading' \|\| loadState === 'hidden'\) return null;/u,
  );
  assert.match(settings, /GEMINI_API_KEY migration fallbackが構成されています/u);
  assert.match(settings, /この操作だけではAIアクセス停止を保証しません/u);
  assert.match(settings, /store障害・master key異常時はfail closed/u);
  assert.doesNotMatch(settings, /setApiKey\([^)]*status/u);
  assert.doesNotMatch(settings, /value=\{status\./u);
});

test('Moonshot credential mutation remains platform-admin and same-origin protected', () => {
  const route = readFileSync(moonshotRoutePath, 'utf8');

  assert.match(route, /isStudioPlatformAdmin/u);
  assert.match(route, /isSameOriginMutationRequest/u);
  assert.match(route, /readRequestBodyBytes\(request, MAX_REQUEST_BODY_BYTES\)/u);
  assert.match(route, /'Cache-Control': 'no-store'/u);
  assert.match(route, /environmentFallbackConfigured: hasMoonshotEnvironmentFallback\(\)/u);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*apiKey/u);
});

test('Studio Moonshot credential UI is write-only, authorization-gated, and explicit about migration fallback', () => {
  const settings = readFileSync(moonshotSettingsPath, 'utf8');

  assert.match(settings, /type="password"/u);
  assert.match(settings, /保存済みキーは再表示しません/u);
  assert.match(
    settings,
    /if \(loadState === 'loading' \|\| loadState === 'hidden'\) return null;/u,
  );
  assert.match(settings, /MOONSHOT_API_KEY migration fallbackが構成されています/u);
  assert.match(settings, /この操作だけではAIアクセス停止を保証しません/u);
  assert.match(settings, /store障害・master key異常時はfail closed/u);
  assert.doesNotMatch(settings, /setApiKey\([^)]*status/u);
  assert.doesNotMatch(settings, /value=\{status\./u);
});

test('Semantic Search rate-limits before credential lookup and fails closed on store errors', () => {
  const route = readFileSync(semanticRoutePath, 'utf8');
  const rateIndex = route.indexOf('semanticRateLimiter.consume(session.user.id)');
  const credentialResolveIndex = route.indexOf('const apiKey = await resolveOpenAiApiKey()');
  const runtimeIndex = route.indexOf('readRuntimeSecret(prisma, OPENAI_API_KEY_RUNTIME_SECRET)');
  const envIndex = route.indexOf('process.env.OPENAI_API_KEY?.trim() || null');

  assert.ok(rateIndex >= 0, 'semantic search must apply the user rate limit');
  assert.ok(
    credentialResolveIndex > rateIndex,
    'credential lookup must happen after rate limiting',
  );
  assert.ok(runtimeIndex > credentialResolveIndex, 'runtime secret resolver must be used');
  assert.ok(envIndex > runtimeIndex, 'OPENAI_API_KEY must remain fallback-only');
  assert.match(route, /error instanceof RuntimeSecretError/u);
  assert.match(route, /credential store is unavailable; failing closed/u);
  assert.doesNotMatch(route, /credential store is unavailable; env fallback remains active/u);
});

test('AI Runtime Settings only exposes and saves providers with usable credentials', () => {
  const route = readFileSync(runtimeSettingsRoutePath, 'utf8');
  const availabilityIndex = route.indexOf('resolveProviderPolicyView()');
  const saveIndex = route.indexOf('setRuntimeConfiguration(prisma');

  assert.ok(availabilityIndex >= 0, 'runtime API must resolve provider credential availability');
  assert.ok(saveIndex > availabilityIndex, 'credential availability must be checked before saving');
  assert.match(route, /readRuntimeSecret\(prisma, OPENAI_API_KEY_RUNTIME_SECRET, process\.env\)/u);
  assert.match(
    route,
    /readRuntimeSecret\(prisma, GOOGLE_GEMINI_API_KEY_RUNTIME_SECRET, process\.env\)/u,
  );
  assert.match(
    route,
    /readRuntimeSecret\(prisma, MOONSHOT_API_KEY_RUNTIME_SECRET, process\.env\)/u,
  );
  assert.match(route, /getAiRuntimePolicyMetadata\(\)\.filter/u);
  assert.match(route, /if \(!availability\?\.available\)/u);
  assert.match(route, /missingCredential \? 409 : 503/u);
  assert.match(route, /providerAvailability: providerView\.providerAvailability/u);
  assert.doesNotMatch(route, /console\.(?:log|info|warn|error)\([^\n]*(?:apiKey|credential)/u);
});
