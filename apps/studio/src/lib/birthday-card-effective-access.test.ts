import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyStudioAccessPolicy } from './studio-access-policy.ts';
import {
  hasEffectivePluginPermission,
  setExplicitPermissionMode,
  type EffectivePluginPermissionContext,
} from './studio-plugin-permissions.ts';
import { studioBirthdayResource } from './studio-policy-resources.ts';

const GUILD_ID = '123456789012345678';
const ROLE_ID = '234567890123456789';

function baseAccess(): EffectivePluginPermissionContext {
  return {
    isRoot: false,
    roleIds: [ROLE_ID],
    policies: [],
    managedPolicies: [],
  };
}

test('Policy未導入のManage GuildユーザーはBirthday Card背景を従来どおり利用できる', () => {
  const access = baseAccess();
  const resource = studioBirthdayResource(GUILD_ID, 'card-background');

  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.read', resource), true);
  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.write', resource), true);
});

test('Birthday Card背景へ明示DenyしたPolicyはlegacy互換Allowより優先する', () => {
  const resource = studioBirthdayResource(GUILD_ID, 'card-background');
  let policy = createEmptyStudioAccessPolicy();
  policy = setExplicitPermissionMode(policy, 'studio.settings.read', resource, 'deny');
  policy = setExplicitPermissionMode(policy, 'studio.settings.write', resource, 'deny');
  const access: EffectivePluginPermissionContext = {
    ...baseAccess(),
    policies: [{ discordRoleId: ROLE_ID, policy }],
  };

  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.read', resource), false);
  assert.equal(hasEffectivePluginPermission(access, 'studio.settings.write', resource), false);
});
