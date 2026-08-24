import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExpectedRuntimeConsumers } from '@herta/shared';
import {
  PLUGIN_RUNTIME_APPLY_DELAY_MS,
  buildPluginRuntimeConsumerStates,
  resolvePluginOperationAttentionReason,
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

function runtimeRow(
  runtimeConsumers: PluginOperationInventoryRow['runtimeConsumers'],
): PluginOperationInventoryRow {
  return {
    guildId: '10000000000000001',
    pluginId: 'quote',
    pluginName: 'Quote',
    enabled: true,
    configValid: true,
    configVersion: 8,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeStatus: 'applied',
    runtimeConfigVersion: 8,
    runtimeObservedAt: '2026-08-22T04:00:03.000Z',
    runtimeConsumers,
  };
}

test('Plugin状態をHealthy / Attention / Pausedへ分類する', () => {
  assert.equal(resolvePluginOperationStatus(true, true), 'healthy');
  assert.equal(resolvePluginOperationStatus(true, false), 'attention');
  assert.equal(resolvePluginOperationStatus(false, true), 'paused');
  assert.equal(resolvePluginOperationStatus(false, false), 'paused');
});

test('expected Runtime consumer未指定・空配列はBotへ後方互換し明示値は重複排除する', () => {
  assert.deepEqual(resolveExpectedRuntimeConsumers({}), ['bot']);
  assert.deepEqual(resolveExpectedRuntimeConsumers({ expectedRuntimeConsumers: [] }), ['bot']);
  assert.deepEqual(
    resolveExpectedRuntimeConsumers({ expectedRuntimeConsumers: ['worker', 'bot', 'worker'] }),
    ['worker', 'bot'],
  );
});

test('Bot onlyではBot Applied / Worker Not expectedとなりHealthyを維持する', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot'], [
    {
      consumer: 'bot',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:03.000Z',
    },
  ]);

  assert.deepEqual(runtimeConsumers, [
    {
      consumer: 'bot',
      expected: true,
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:03.000Z',
    },
    { consumer: 'worker', expected: false, status: 'not_expected' },
  ]);
  assert.equal(resolvePluginOperationAttentionReason(runtimeRow(runtimeConsumers)), null);
});

test('unexpected Worker ACKはBot only quorumを満たしたり壊したりしない', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot'], [
    {
      consumer: 'bot',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:03.000Z',
    },
    {
      consumer: 'worker',
      status: 'apply_failed',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:04.000Z',
    },
  ]);

  assert.deepEqual(runtimeConsumers[1], {
    consumer: 'worker',
    expected: false,
    status: 'not_expected',
  });
  assert.equal(resolvePluginOperationAttentionReason(runtimeRow(runtimeConsumers)), null);
});

test('Bot + Worker expectedで両方AppliedならHealthyになる', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot', 'worker'], [
    {
      consumer: 'bot',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:03.000Z',
    },
    {
      consumer: 'worker',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:04.000Z',
    },
  ]);

  assert.equal(runtimeConsumers[0]?.status, 'applied');
  assert.equal(runtimeConsumers[1]?.status, 'applied');
  assert.equal(resolvePluginOperationAttentionReason(runtimeRow(runtimeConsumers)), null);
});

test('expected Worker apply失敗はBot成功でもAttentionになる', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot', 'worker'], [
    {
      consumer: 'bot',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:03.000Z',
    },
    {
      consumer: 'worker',
      status: 'apply_failed',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:04.000Z',
    },
  ]);

  assert.equal(runtimeConsumers[1]?.status, 'failed');
  assert.equal(
    resolvePluginOperationAttentionReason(runtimeRow(runtimeConsumers)),
    'runtime_apply_failed',
  );
});

test('expected Worker ACK待ちは閾値まではPending、超過後にAttentionになる', () => {
  const observedAt = Date.parse('2026-08-22T04:00:00.000Z');
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot', 'worker'], [
    {
      consumer: 'bot',
      status: 'applied',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:01.000Z',
    },
    {
      consumer: 'worker',
      status: 'published',
      configVersion: 8,
      observedAt: new Date(observedAt).toISOString(),
    },
  ]);
  const row = runtimeRow(runtimeConsumers);

  assert.equal(runtimeConsumers[1]?.status, 'pending');
  assert.equal(
    resolvePluginOperationAttentionReason(row, observedAt + PLUGIN_RUNTIME_APPLY_DELAY_MS - 1),
    null,
  );
  assert.equal(
    resolvePluginOperationAttentionReason(row, observedAt + PLUGIN_RUNTIME_APPLY_DELAY_MS),
    'runtime_apply_delayed',
  );
});

test('Runtime signalがないexpected consumerはNo signalで即Attentionにしない', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['bot'], []);
  const row = runtimeRow(runtimeConsumers);
  delete row.runtimeStatus;
  delete row.runtimeConfigVersion;
  delete row.runtimeObservedAt;

  assert.equal(runtimeConsumers[0]?.status, 'no_signal');
  assert.equal(resolvePluginOperationAttentionReason(row), null);
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
  assert.equal(result.entries[0]?.attentionReason, 'config_invalid');

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

test('Runtime publish失敗とapply失敗をAttentionへ分類する', () => {
  const base: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'quote',
    pluginName: 'Quote',
    enabled: true,
    configValid: true,
    configVersion: 8,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeConfigVersion: 8,
    runtimeObservedAt: '2026-08-22T04:00:01.000Z',
  };

  assert.equal(
    resolvePluginOperationAttentionReason({ ...base, runtimeStatus: 'publish_failed' }),
    'runtime_publish_failed',
  );
  assert.equal(
    resolvePluginOperationAttentionReason({ ...base, runtimeStatus: 'apply_failed' }),
    'runtime_apply_failed',
  );
  assert.equal(resolvePluginOperationAttentionReason({ ...base, runtimeStatus: 'applied' }), null);
});

test('publish失敗はconsumer quorumに関係なくAttentionになる', () => {
  const runtimeConsumers = buildPluginRuntimeConsumerStates(['worker'], [
    {
      consumer: 'bot',
      status: 'publish_failed',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:01.000Z',
    },
    {
      consumer: 'worker',
      status: 'publish_failed',
      configVersion: 8,
      observedAt: '2026-08-22T04:00:01.000Z',
    },
  ]);
  const row = runtimeRow(runtimeConsumers);
  row.runtimeStatus = 'publish_failed';
  row.runtimeObservedAt = '2026-08-22T04:00:01.000Z';

  assert.equal(runtimeConsumers[0]?.status, 'not_expected');
  assert.equal(runtimeConsumers[1]?.status, 'no_signal');
  assert.equal(resolvePluginOperationAttentionReason(row), 'runtime_publish_failed');
});

test('Plugin無効化のRuntime失敗をPausedではなくAttentionへ分類する', () => {
  const row: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'moderation',
    pluginName: 'Moderation',
    enabled: false,
    configValid: true,
    configVersion: 10,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeStatus: 'publish_failed',
    runtimeConfigVersion: 10,
    runtimeObservedAt: '2026-08-22T04:00:01.000Z',
  };

  const reason = resolvePluginOperationAttentionReason(row);
  assert.equal(reason, 'runtime_publish_failed');
  assert.equal(resolvePluginOperationStatus(row.enabled, row.configValid, reason), 'attention');

  const result = summarizePluginOperations([row.guildId], 1, [row]);
  assert.equal(result.enabledInstances, 0);
  assert.equal(result.attentionInstances, 1);
  assert.equal(result.pausedInstances, 0);
});

test('publish成功後にACKが閾値を超えて届かなければAttentionへ分類する', () => {
  const observedAt = Date.parse('2026-08-22T04:00:00.000Z');
  const row: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'lfg',
    pluginName: 'LFG',
    enabled: true,
    configValid: true,
    configVersion: 5,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeStatus: 'published',
    runtimeConfigVersion: 5,
    runtimeObservedAt: new Date(observedAt).toISOString(),
  };

  assert.equal(
    resolvePluginOperationAttentionReason(row, observedAt + PLUGIN_RUNTIME_APPLY_DELAY_MS - 1),
    null,
  );
  assert.equal(
    resolvePluginOperationAttentionReason(row, observedAt + PLUGIN_RUNTIME_APPLY_DELAY_MS),
    'runtime_apply_delayed',
  );
});

test('無効化publishのACK遅延もAttentionへ分類する', () => {
  const observedAt = Date.parse('2026-08-22T04:00:00.000Z');
  const row: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'quote',
    pluginName: 'Quote',
    enabled: false,
    configValid: true,
    configVersion: 6,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeStatus: 'published',
    runtimeConfigVersion: 6,
    runtimeObservedAt: new Date(observedAt).toISOString(),
  };

  assert.equal(
    resolvePluginOperationAttentionReason(row, observedAt + PLUGIN_RUNTIME_APPLY_DELAY_MS),
    'runtime_apply_delayed',
  );
});

test('旧configVersionのRuntime失敗は現在設定のAttentionにしない', () => {
  const row: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'quote',
    pluginName: 'Quote',
    enabled: true,
    configValid: true,
    configVersion: 9,
    installedAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-22T04:00:00.000Z',
    runtimeStatus: 'apply_failed',
    runtimeConfigVersion: 8,
    runtimeObservedAt: '2026-08-22T04:00:02.000Z',
  };

  assert.equal(resolvePluginOperationAttentionReason(row), null);
  assert.equal(summarizePluginOperations([row.guildId], 1, [row]).attentionInstances, 0);
});

test('Runtime履歴がない既存Pluginは後方互換でHealthyを維持する', () => {
  const row: PluginOperationInventoryRow = {
    guildId: '10000000000000001',
    pluginId: 'legacy-plugin',
    pluginName: 'Legacy Plugin',
    enabled: true,
    configValid: true,
    configVersion: 12,
    installedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };

  assert.equal(resolvePluginOperationAttentionReason(row), null);
  assert.equal(summarizePluginOperations([row.guildId], 1, [row]).healthyInstances, 1);
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
