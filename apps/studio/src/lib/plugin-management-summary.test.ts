import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePluginManagementRows } from './plugin-management-summary.ts';

test('Guildごとの設定済み数と有効数を集計する', () => {
  const result = summarizePluginManagementRows(['guild-a', 'guild-b'], 6, [
    { guildId: 'guild-a', enabled: true },
    { guildId: 'guild-a', enabled: false },
    { guildId: 'guild-b', enabled: true },
  ]);

  assert.equal(result.availablePlugins, 6);
  assert.equal(result.installedInstances, 3);
  assert.equal(result.enabledInstances, 2);
  assert.deepEqual(result.byGuild, {
    'guild-a': { installed: 2, enabled: 1 },
    'guild-b': { installed: 1, enabled: 1 },
  });
});

test('管理対象外Guildの行は集計へ含めない', () => {
  const result = summarizePluginManagementRows(['guild-a'], 4, [
    { guildId: 'guild-a', enabled: false },
    { guildId: 'unknown-guild', enabled: true },
  ]);

  assert.equal(result.installedInstances, 1);
  assert.equal(result.enabledInstances, 0);
  assert.deepEqual(result.byGuild, {
    'guild-a': { installed: 1, enabled: 0 },
  });
});

test('Guildが空でも利用可能Plugin数を維持して空集計を返す', () => {
  const result = summarizePluginManagementRows([], 7, []);

  assert.equal(result.availablePlugins, 7);
  assert.equal(result.installedInstances, 0);
  assert.equal(result.enabledInstances, 0);
  assert.deepEqual(result.byGuild, {});
});
