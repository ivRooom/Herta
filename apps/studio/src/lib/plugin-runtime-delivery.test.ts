import { describe, expect, it } from 'vitest';
import { createPluginRuntimeEvent } from '@herta/shared';
import { createPluginRuntimePublishAuditData } from './plugin-runtime-delivery';

describe('createPluginRuntimePublishAuditData', () => {
  const event = createPluginRuntimeEvent({
    guildId: '12345678901234567',
    pluginId: 'quote',
    configVersion: 7,
    eventType: 'config_updated',
    occurredAt: new Date('2026-08-22T04:00:00.000Z'),
  });

  it('publish成功時にsubscriber数とevent識別子だけを保存する', () => {
    const data = createPluginRuntimePublishAuditData(event, {
      status: 'published',
      subscriberCount: 2,
    });

    expect(data).toMatchObject({
      guildId: event.guildId,
      actorType: 'service',
      event: 'plugin.runtime_publish_succeeded',
      targetType: 'plugin',
      targetId: event.pluginId,
      severity: 'info',
      metadata: {
        eventId: event.eventId,
        eventType: event.eventType,
        configVersion: 7,
        subscriberCount: 2,
      },
    });
    expect(JSON.stringify(data)).not.toContain('REDIS_URL');
  });

  it('publish失敗時にSecretや例外本文ではなく分類済みreasonだけを保存する', () => {
    const data = createPluginRuntimePublishAuditData(event, {
      status: 'publish_failed',
      reason: 'publish_error',
    });

    expect(data.event).toBe('plugin.runtime_publish_failed');
    expect(data.severity).toBe('warning');
    expect(data.metadata).toMatchObject({ failureReason: 'publish_error', configVersion: 7 });
    expect(data.metadata).not.toHaveProperty('subscriberCount');
  });
});
