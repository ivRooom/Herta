import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePluginPreflight } from './plugin-hub-preflight.ts';

test('必須依存Pluginが有効ならReadyになる', () => {
  const result = analyzePluginPreflight([
    { pluginId: 'core-tools', optional: false, installed: true, enabled: true },
  ]);

  assert.equal(result.ready, true);
  assert.deepEqual(result.missingRequiredPluginIds, []);
});

test('必須依存Pluginが未導入または無効ならBlockedになる', () => {
  const result = analyzePluginPreflight([
    { pluginId: 'missing-plugin', optional: false, installed: false, enabled: false },
    { pluginId: 'disabled-plugin', optional: false, installed: true, enabled: false },
  ]);

  assert.equal(result.ready, false);
  assert.deepEqual(result.missingRequiredPluginIds, ['missing-plugin', 'disabled-plugin']);
});

test('optional依存Pluginが無効でもReadyを維持する', () => {
  const result = analyzePluginPreflight([
    { pluginId: 'optional-addon', optional: true, installed: false, enabled: false },
  ]);

  assert.equal(result.ready, true);
  assert.deepEqual(result.missingRequiredPluginIds, []);
  assert.deepEqual(result.inactiveOptionalPluginIds, ['optional-addon']);
});
