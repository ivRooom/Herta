import type { PluginRuntimeEvent } from '@herta/shared';

export type PluginRuntimePublishOutcome =
  | { status: 'published'; subscriberCount: number }
  | { status: 'publish_failed'; reason: 'redis_unconfigured' | 'no_subscribers' | 'publish_error' };

export function createPluginRuntimePublishAuditData(
  event: PluginRuntimeEvent,
  outcome: PluginRuntimePublishOutcome,
) {
  const succeeded = outcome.status === 'published';
  return {
    guildId: event.guildId,
    actorId: 'herta-studio',
    actorType: 'service',
    event: succeeded ? 'plugin.runtime_publish_succeeded' : 'plugin.runtime_publish_failed',
    targetType: 'plugin',
    targetId: event.pluginId,
    severity: succeeded ? 'info' : 'warning',
    metadata: {
      operationSource: 'studio-runtime',
      eventId: event.eventId,
      eventType: event.eventType,
      configVersion: event.configVersion,
      ...(succeeded
        ? { subscriberCount: outcome.subscriberCount }
        : { failureReason: outcome.reason }),
    },
  } as const;
}

export async function recordPluginRuntimePublishOutcome(
  event: PluginRuntimeEvent,
  outcome: PluginRuntimePublishOutcome,
): Promise<void> {
  try {
    // Keep the pure audit-data builder testable by Node's native test runner without
    // resolving the Studio-only @/* alias until persistence is actually requested.
    const { prisma } = await import('@/lib/db');
    await prisma.auditLog.create({ data: createPluginRuntimePublishAuditData(event, outcome) });
  } catch (error) {
    console.error('Plugin Runtime publish結果の監査ログ保存に失敗しました', {
      guildId: event.guildId,
      pluginId: event.pluginId,
      configVersion: event.configVersion,
      outcome: outcome.status,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
