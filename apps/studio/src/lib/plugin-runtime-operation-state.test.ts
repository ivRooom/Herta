import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPluginRuntimeConsumerOperationStateMap,
  buildPluginRuntimeOperationStateMap,
  pluginRuntimeConsumerOperationStateKey,
  pluginRuntimeOperationStateKey,
  type PluginRuntimeAuditRow,
} from './plugin-runtime-operation-state.ts';

const guildId = '10000000000000001';
const pluginId = 'quote';

function row(
  event: string,
  metadata: unknown,
  createdAt: string,
  targetId: string | null = pluginId,
): PluginRuntimeAuditRow {
  return { guildId, targetId, event, metadata, createdAt: new Date(createdAt) };
}

test('最新のBot Runtime監査イベントをconfigVersion単位で状態化する', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row(
      'plugin.runtime_apply_succeeded',
      { configVersion: 4, consumer: 'bot' },
      '2026-08-22T04:00:03.000Z',
    ),
    row('plugin.runtime_publish_succeeded', { configVersion: 4 }, '2026-08-22T04:00:01.000Z'),
    row(
      'plugin.runtime_apply_failed',
      { configVersion: 3, consumer: 'bot' },
      '2026-08-22T03:00:03.000Z',
    ),
  ]);

  assert.deepEqual(states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4)), {
    status: 'applied',
    configVersion: 4,
    observedAt: '2026-08-22T04:00:03.000Z',
    consumer: 'bot',
  });
  assert.equal(
    states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 3))?.status,
    'apply_failed',
  );
});

test('consumerなしのlegacy apply ACKはBotとして後方互換に扱う', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row('plugin.runtime_apply_succeeded', { configVersion: 4 }, '2026-08-22T04:00:03.000Z'),
  ]);

  assert.equal(states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4))?.consumer, 'bot');
  assert.equal(states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4))?.status, 'applied');
});

test('Worker ACKはBot状態を上書きせずconsumer別に集計できる', () => {
  const rows = [
    row(
      'plugin.runtime_apply_failed',
      { configVersion: 4, eventId: 'runtime-event-4', consumer: 'worker' },
      '2026-08-22T04:00:04.000Z',
    ),
    row(
      'plugin.runtime_apply_succeeded',
      { configVersion: 4, eventId: 'runtime-event-4', consumer: 'bot' },
      '2026-08-22T04:00:03.000Z',
    ),
    row(
      'plugin.runtime_publish_succeeded',
      { configVersion: 4, eventId: 'runtime-event-4' },
      '2026-08-22T04:00:02.000Z',
    ),
  ];

  const botStates = buildPluginRuntimeOperationStateMap(rows);
  const workerStates = buildPluginRuntimeConsumerOperationStateMap(rows, 'worker');

  assert.equal(botStates.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4))?.status, 'applied');
  assert.equal(
    workerStates.get(pluginRuntimeConsumerOperationStateKey(guildId, pluginId, 4, 'worker'))
      ?.status,
    'apply_failed',
  );
});

test('未知consumerのapply ACKは安全側に無視する', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row(
      'plugin.runtime_apply_succeeded',
      { configVersion: 4, consumer: 'unknown-runtime' },
      '2026-08-22T04:00:03.000Z',
    ),
    row('plugin.runtime_publish_succeeded', { configVersion: 4 }, '2026-08-22T04:00:02.000Z'),
  ]);

  assert.equal(states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4))?.status, 'published');
});

test('同一eventのapply ACKがpublish監査より先に保存されてもapply結果を優先する', () => {
  const eventId = 'runtime-event-4';
  const states = buildPluginRuntimeOperationStateMap([
    row(
      'plugin.runtime_publish_succeeded',
      { configVersion: 4, eventId },
      '2026-08-22T04:00:03.000Z',
    ),
    row(
      'plugin.runtime_apply_succeeded',
      { configVersion: 4, eventId, consumer: 'bot' },
      '2026-08-22T04:00:02.000Z',
    ),
  ]);

  assert.deepEqual(states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4)), {
    status: 'applied',
    configVersion: 4,
    observedAt: '2026-08-22T04:00:02.000Z',
    consumer: 'bot',
  });
});

test('同じversionでも別eventなら新しいeventの状態を維持する', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row(
      'plugin.runtime_publish_succeeded',
      { configVersion: 4, eventId: 'new-event' },
      '2026-08-22T04:00:03.000Z',
    ),
    row(
      'plugin.runtime_apply_succeeded',
      { configVersion: 4, eventId: 'old-event', consumer: 'bot' },
      '2026-08-22T04:00:02.000Z',
    ),
  ]);

  assert.equal(
    states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 4))?.status,
    'published',
  );
});

test('publish失敗と未ACK publishを区別する', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row('plugin.runtime_publish_failed', { configVersion: 8 }, '2026-08-22T04:00:02.000Z'),
    row('plugin.runtime_publish_succeeded', { configVersion: 7 }, '2026-08-22T03:00:02.000Z'),
  ]);

  assert.equal(
    states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 8))?.status,
    'publish_failed',
  );
  assert.equal(
    states.get(pluginRuntimeOperationStateKey(guildId, pluginId, 7))?.status,
    'published',
  );
});

test('不正metadata・対象なし・未知eventは無視する', () => {
  const states = buildPluginRuntimeOperationStateMap([
    row('plugin.runtime_apply_succeeded', { configVersion: '4' }, '2026-08-22T04:00:03.000Z'),
    row('plugin.runtime_apply_succeeded', null, '2026-08-22T04:00:03.000Z'),
    row('plugin.runtime_apply_succeeded', { configVersion: -1 }, '2026-08-22T04:00:03.000Z'),
    row('plugin.runtime_apply_succeeded', { configVersion: 4 }, '2026-08-22T04:00:03.000Z', null),
    row('plugin.config_update', { configVersion: 4 }, '2026-08-22T04:00:04.000Z'),
  ]);

  assert.equal(states.size, 0);
});
