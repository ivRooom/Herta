import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyStudioAccessPolicy,
  createStudioRolePolicyFromActions,
} from './studio-access-policy.ts';
import {
  filterReadablePluginConfig,
  getExplicitPermissionMode,
  hasEffectivePluginPermission,
  pluginConfigFieldResource,
  pluginEnabledControlResource,
  resolvePluginConfigStudioAccess,
  setExplicitPermissionMode,
  type EffectivePluginPermissionContext,
} from './studio-plugin-permissions.ts';

const GUILD_ID = '123456789012345678';
const ROLE_ID = '234567890123456789';

test('Plugin config field resourceをGuild scopeで生成する', () => {
  assert.equal(
    pluginConfigFieldResource(GUILD_ID, 'mini-games', 'blackjack.animation'),
    `guild:${GUILD_ID}:plugin:mini-games:config:blackjack.animation`,
  );
});

test('Plugin enabled control resourceを生成する', () => {
  assert.equal(
    pluginEnabledControlResource(GUILD_ID, 'mini-games'),
    `guild:${GUILD_ID}:plugin:mini-games:control:enabled`,
  );
});

test('Plugin field権限をAllow/Deny/継承へ切り替えられる', () => {
  const resource = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'amidakujiTheme');
  const empty = createEmptyStudioAccessPolicy();

  const allowed = setExplicitPermissionMode(empty, 'studio.settings.write', resource, 'allow');
  assert.equal(getExplicitPermissionMode(allowed, 'studio.settings.write', resource), 'allow');
  assert.equal(allowed.Statement[0]?.Effect, 'Allow');

  const denied = setExplicitPermissionMode(allowed, 'studio.settings.write', resource, 'deny');
  assert.equal(getExplicitPermissionMode(denied, 'studio.settings.write', resource), 'deny');
  assert.equal(denied.Statement.length, 1);
  assert.equal(denied.Statement[0]?.Effect, 'Deny');

  const inherited = setExplicitPermissionMode(denied, 'studio.settings.write', resource, 'inherit');
  assert.equal(getExplicitPermissionMode(inherited, 'studio.settings.write', resource), 'inherit');
  assert.equal(inherited.Statement.length, 0);
});

test('別Resource向けStatementを壊さない', () => {
  const first = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'amidakujiTheme');
  const second = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'amidakujiComplexity');
  let policy = createEmptyStudioAccessPolicy();
  policy = setExplicitPermissionMode(policy, 'studio.settings.write', first, 'deny');
  policy = setExplicitPermissionMode(policy, 'studio.settings.write', second, 'allow');

  assert.equal(getExplicitPermissionMode(policy, 'studio.settings.write', first), 'deny');
  assert.equal(getExplicitPermissionMode(policy, 'studio.settings.write', second), 'allow');
  assert.equal(policy.Statement.length, 2);
});

test('rootはPlugin権限を常に持つ', () => {
  const access: EffectivePluginPermissionContext = {
    isRoot: true,
    roleIds: [],
    policies: [],
    managedPolicies: [],
  };
  assert.equal(
    hasEffectivePluginPermission(
      access,
      'studio.settings.write',
      pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme'),
    ),
    true,
  );
});

test('適用対象PolicyがないManage Guildユーザーは従来権限を維持する', () => {
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [
      {
        discordRoleId: '999999999999999999',
        policy: createEmptyStudioAccessPolicy(),
      },
    ],
    managedPolicies: [],
  };
  assert.equal(
    hasEffectivePluginPermission(
      access,
      'studio.settings.write',
      pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme'),
    ),
    true,
  );
});

test('適用対象Policyが存在する場合はwriteがdefault denyになる', () => {
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [{ discordRoleId: ROLE_ID, policy: createEmptyStudioAccessPolicy() }],
    managedPolicies: [],
  };
  assert.equal(
    hasEffectivePluginPermission(
      access,
      'studio.settings.write',
      pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme'),
    ),
    false,
  );
});

test('settings.read未導入の既存Policyでは設定値の閲覧互換を維持する', () => {
  const writeOnly = createStudioRolePolicyFromActions(GUILD_ID, ['studio.settings.write']);
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [{ discordRoleId: ROLE_ID, policy: writeOnly }],
    managedPolicies: [],
  };
  const resolved = resolvePluginConfigStudioAccess(access, GUILD_ID, 'mini-games', [
    'theme',
    'complexity',
  ]);
  assert.deepEqual(resolved.readableFieldKeys, ['theme', 'complexity']);
});

test('settings.readを導入すると項目単位のdefault denyで値を隠す', () => {
  const themeResource = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme');
  let policy = createEmptyStudioAccessPolicy();
  policy = setExplicitPermissionMode(policy, 'studio.settings.read', themeResource, 'allow');
  policy = setExplicitPermissionMode(policy, 'studio.settings.write', themeResource, 'allow');
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [{ discordRoleId: ROLE_ID, policy }],
    managedPolicies: [],
  };

  const resolved = resolvePluginConfigStudioAccess(access, GUILD_ID, 'mini-games', [
    'theme',
    'secretValue',
  ]);
  assert.deepEqual(resolved.readableFieldKeys, ['theme']);
  assert.deepEqual(resolved.editableFieldKeys, ['theme']);
  assert.deepEqual(filterReadablePluginConfig({ theme: 'dark', secretValue: 'hidden' }, resolved), {
    theme: 'dark',
  });
});

test('全体Allowより項目Denyを優先してConfig Studio権限を解決する', () => {
  const deniedField = 'amidakujiTheme';
  let policy = createStudioRolePolicyFromActions(GUILD_ID, [
    'studio.settings.read',
    'studio.settings.write',
    'studio.operation.execute',
  ]);
  policy = setExplicitPermissionMode(
    policy,
    'studio.settings.write',
    pluginConfigFieldResource(GUILD_ID, 'mini-games', deniedField),
    'deny',
  );
  policy = setExplicitPermissionMode(
    policy,
    'studio.operation.execute',
    pluginEnabledControlResource(GUILD_ID, 'mini-games'),
    'deny',
  );
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [{ discordRoleId: ROLE_ID, policy }],
    managedPolicies: [],
  };

  assert.deepEqual(
    resolvePluginConfigStudioAccess(access, GUILD_ID, 'mini-games', [
      deniedField,
      'amidakujiComplexity',
    ]),
    {
      canToggleEnabled: false,
      readableFieldKeys: [deniedField, 'amidakujiComplexity'],
      editableFieldKeys: ['amidakujiComplexity'],
    },
  );
});

test('複数Roleでは明示Denyが別RoleのAllowより優先される', () => {
  const secondRoleId = '345678901234567890';
  const resource = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme');
  let allowed = createEmptyStudioAccessPolicy();
  allowed = setExplicitPermissionMode(allowed, 'studio.settings.write', resource, 'allow');
  let denied = createEmptyStudioAccessPolicy();
  denied = setExplicitPermissionMode(denied, 'studio.settings.write', resource, 'deny');
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID, secondRoleId],
    policies: [
      { discordRoleId: ROLE_ID, policy: allowed },
      { discordRoleId: secondRoleId, policy: denied },
    ],
    managedPolicies: [],
  };

  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.write', resource), false);
});

test('Managed PolicyのDenyがLegacy Role PolicyのAllowより優先される', () => {
  const resource = pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme');
  let legacyAllow = createEmptyStudioAccessPolicy();
  legacyAllow = setExplicitPermissionMode(legacyAllow, 'studio.settings.write', resource, 'allow');
  let managedDeny = createEmptyStudioAccessPolicy();
  managedDeny = setExplicitPermissionMode(managedDeny, 'studio.settings.write', resource, 'deny');
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [{ discordRoleId: ROLE_ID, policy: legacyAllow }],
    managedPolicies: [managedDeny],
  };

  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.write', resource), false);
});

test('Managed Policyだけが存在する場合もwriteはdefault denyへ移行する', () => {
  const access: EffectivePluginPermissionContext = {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [],
    managedPolicies: [createEmptyStudioAccessPolicy()],
  };

  assert.equal(
    hasEffectivePluginPermission(
      access,
      'studio.settings.write',
      pluginConfigFieldResource(GUILD_ID, 'mini-games', 'theme'),
    ),
    false,
  );
});
