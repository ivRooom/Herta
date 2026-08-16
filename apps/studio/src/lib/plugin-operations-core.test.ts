import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePluginOperationStatus,
  summarizePluginOperations,
  type PluginOperationInventoryRow,
} from './plugin-operations-core.ts';

const rows: PluginOperationInventoryRow[] = [
  {
    guildId: '10000000000000001',
    pluginId: 'healthy-plugin',
    pluginName: 'Healthy Plugin',
    enabled: true,
    configValid: true,
    configVersion: 3,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  },
  {
    guildId: '10000000000000001',
    pluginId: 'attention-plugin',
    pluginName: 'Attention Plugin',
    enabled: true,
    configValid: false,
    configVersion: 4,
    installedAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    guildId: '10000000000000002',
    pluginId: 'paused-plugin',
    pluginName: 'Paused Plugin',
    enabled: false,
    configValid: false,
    configVersion: 1,
    installedAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  },
  {
    guildId: '99999999999999999',
    pluginId: 'foreign-plugin',
    pluginName: 'Foreign Plugin',
    enabled: true,
    configValid: false,
    configVersion: 9,
    installedAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-15T12:00:00.000Z',
  },
];

test('Plugin状態をHealthy / Attention / Pausedへ分類する', () => {
  assert.equal(resolvePluginOperationStatus(true, true), 'healthy');
  assert.equal(resolvePluginOperationStatus(true, false), 'attention');
  assert.equal(resolvePluginOperationStatus(false, true), 'paused');
  assert.equal(resolvePluginOperationStatus(false, false), 'paused');
});

test('管理対象Guildだけを横断集計しAttentionを優先表示する', () => {
  const result = summarizePluginOperations(['10000000000000001', '10000000000000002'], 3, rows);

  assert.equal(result.totalSlots, 6);
  assert.equal(result.configuredInstances, 3);
  assert.equal(result.enabledInstances, 2);
  assert.equal(result.healthyInstances, 1);
  assert.equal(result.attentionInstances, 1);
  assert.equal(result.pausedInstances, 1);
  assert.equal(result.notConfiguredInstances, 3);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0]?.pluginId, 'attention-plugin');

  assert.deepEqual(result.byGuild['10000000000000001'], {
    configured: 2,
    enabled: 2,
    healthy: 1,
    attention: 1,
    paused: 0,
    notConfigured: 1,
  });
  assert.deepEqual(result.byGuild['10000000000000002'], {
    configured: 1,
    enabled: 0,
    healthy: 0,
    attention: 0,
    paused: 1,
    notConfigured: 2,
  });
});

test('重複Guild IDを1サーバーとして集計する', () => {
  const result = summarizePluginOperations(['10000000000000001', '10000000000000001'], 3, rows);

  assert.equal(result.totalSlots, 3);
  assert.equal(result.configuredInstances, 2);
  assert.equal(result.notConfiguredInstances, 1);
  assert.deepEqual(Object.keys(result.byGuild), ['10000000000000001']);
});

test('Guildが0件なら安全なEmpty集計を返す', () => {
  const result = summarizePluginOperations([], 4, rows);

  assert.equal(result.totalSlots, 0);
  assert.equal(result.configuredInstances, 0);
  assert.equal(result.enabledInstances, 0);
  assert.equal(result.attentionInstances, 0);
  assert.equal(result.notConfiguredInstances, 0);
  assert.deepEqual(result.byGuild, {});
  assert.deepEqual(result.entries, []);
});
