import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyStudioAccessPolicy } from './studio-access-policy';
import {
  getExplicitPermissionMode,
  pluginConfigFieldResource,
  pluginEnabledControlResource,
  setExplicitPermissionMode,
} from './studio-plugin-permissions';

const GUILD_ID = '123456789012345678';

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
