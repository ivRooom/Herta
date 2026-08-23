import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginRuntimeEvent } from '@herta/shared';
import { createPluginRuntimePublishAuditData } from './plugin-runtime-delivery.ts';

const event = createPluginRuntimeEvent({
  guildId: '12345678901234567',
  pluginId: 'quote',
  configVersion: 7,
  eventType: 'config_updated',
  occurredAt: new Date('2026-08-22T04:00:00.000Z'),
});

test('publish成功時にsubscriber数とevent識別子だけを保存する', () => {
  const data = createPluginRuntimePublishAuditData(event, {
    status: 'published',
    subscriberCount: 2,
  });

  assert.equal(data.guildId, event.guildId);
  assert.equal(data.actorType, 'service');
  assert.equal(data.event, 'plugin.runtime_publish_succeeded');
  assert.equal(data.targetType, 'plugin');
  assert.equal(data.targetId, event.pluginId);
  assert.equal(data.severity, 'info');
  assert.deepEqual(data.metadata, {
    operationSource: 'studio-runtime',
    eventId: event.eventId,
    eventType: event.eventType,
    configVersion: 7,
    subscriberCount: 2,
  });
  assert.equal(JSON.stringify(data).includes('REDIS_URL'), false);
});

test('publish失敗時にSecretや例外本文ではなく分類済みreasonだけを保存する', () => {
  const data = createPluginRuntimePublishAuditData(event, {
    status: 'publish_failed',
    reason: 'publish_error',
  });

  assert.equal(data.event, 'plugin.runtime_publish_failed');
  assert.equal(data.severity, 'warning');
  assert.deepEqual(data.metadata, {
    operationSource: 'studio-runtime',
    eventId: event.eventId,
    eventType: event.eventType,
    configVersion: 7,
    failureReason: 'publish_error',
  });
  assert.equal('subscriberCount' in data.metadata, false);
});
