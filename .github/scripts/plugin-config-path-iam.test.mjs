import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(
  'apps/studio/src/app/api/guilds/[guildId]/plugins/[pluginId]/route.ts',
  'utf8',
);
const permissions = await readFile('apps/studio/src/lib/studio-plugin-permissions.ts', 'utf8');
const restrictedForm = await readFile(
  'apps/studio/src/components/restricted-plugin-config-form.tsx',
  'utf8',
);
const moderationEnforcementPage = await readFile(
  'apps/studio/src/app/dashboard/guilds/[guildId]/moderation/enforcement/page.tsx',
  'utf8',
);
const moderationDetectionPage = await readFile(
  'apps/studio/src/app/dashboard/guilds/[guildId]/moderation/detection-settings/page.tsx',
  'utf8',
);

assert.match(route, /configPathPatch/);
assert.match(route, /removeConfigPaths/);
assert.match(route, /resolvePluginConfigPermissionPath/);
assert.match(route, /requiredConfigPermissionPaths/);
assert.match(route, /changedPluginConfigPermissionPaths/);
assert.match(route, /hasEffectivePluginConfigPermission/);
assert.match(route, /isSameOriginMutationRequest/);
assert.match(route, /MAX_CONFIG_PATH_OPERATIONS = 256/);
assert.match(route, /MAX_CONFIG_PATH_DEPTH = 16/);

assert.match(permissions, /configPathAncestorPaths/);
assert.match(permissions, /mergeStudioPolicyDecisions/);
assert.match(permissions, /allConfigPathsReadable/);
assert.match(permissions, /allConfigPathsEditable/);

assert.match(restrictedForm, /configPathPatch/);
assert.match(restrictedForm, /IAM: \{entry\.permissionPath\}/);
assert.match(restrictedForm, /aria-readonly/);

for (const page of [moderationEnforcementPage, moderationDetectionPage]) {
  assert.match(page, /pluginConfigPermissionPaths\(plugin\.manifest\.configSchema\)/);
  assert.match(
    page,
    /filterReadablePluginConfig\([\s\S]*plugin\.manifest\.configSchema[\s\S]*\)/,
  );
}
assert.match(moderationEnforcementPage, /allConfigPathsReadable/);
assert.match(moderationEnforcementPage, /allConfigPathsEditable/);
assert.match(moderationDetectionPage, /allConfigPathsReadable/);

console.log('plugin config path IAM contract checks passed');
