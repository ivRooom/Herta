import {
  DEFAULT_PLUGIN_RUNTIME_CONSUMER,
  isPluginRuntimeConsumer,
  type PluginRuntimeConsumer,
} from '@herta/shared';
import type { PluginRuntimeDeliveryStatus } from './plugin-operations-core.ts';

const RUNTIME_EVENT_STATUS = {
  'plugin.runtime_publish_succeeded': 'published',
  'plugin.runtime_publish_failed': 'publish_failed',
  'plugin.runtime_apply_succeeded': 'applied',
  'plugin.runtime_apply_failed': 'apply_failed',
} as const satisfies Record<string, PluginRuntimeDeliveryStatus>;

export const PLUGIN_RUNTIME_AUDIT_EVENTS = Object.keys(RUNTIME_EVENT_STATUS);

export interface PluginRuntimeAuditRow {
  guildId: string;
  targetId: string | null;
  event: string;
  metadata: unknown;
  createdAt: Date;
}

export interface PluginRuntimeOperationState {
  status: PluginRuntimeDeliveryStatus;
  configVersion: number;
  observedAt: string;
  consumer: PluginRuntimeConsumer;
}

export function buildPluginRuntimeOperationStateMap(
  rows: readonly PluginRuntimeAuditRow[],
): Map<string, PluginRuntimeOperationState> {
  return buildPluginRuntimeOperationStateMapForConsumer(
    rows,
    DEFAULT_PLUGIN_RUNTIME_CONSUMER,
    pluginRuntimeOperationStateKey,
  );
}

export function buildPluginRuntimeConsumerOperationStateMap(
  rows: readonly PluginRuntimeAuditRow[],
  consumer: PluginRuntimeConsumer,
): Map<string, PluginRuntimeOperationState> {
  return buildPluginRuntimeOperationStateMapForConsumer(
    rows,
    consumer,
    (guildId, pluginId, version) =>
      pluginRuntimeConsumerOperationStateKey(guildId, pluginId, version, consumer),
  );
}

function buildPluginRuntimeOperationStateMapForConsumer(
  rows: readonly PluginRuntimeAuditRow[],
  consumer: PluginRuntimeConsumer,
  keyFor: (guildId: string, pluginId: string, configVersion: number) => string,
): Map<string, PluginRuntimeOperationState> {
  const states = new Map<string, PluginRuntimeOperationState>();
  const eventIds = new Map<string, string | undefined>();

  for (const row of rows) {
    if (!row.targetId) continue;
    const status = runtimeStatusForEvent(row.event);
    if (!status) continue;
    const configVersion = readConfigVersion(row.metadata);
    if (configVersion === undefined) continue;
    if (isApplyOutcome(status) && runtimeConsumerForMetadata(row.metadata) !== consumer) continue;

    const key = keyFor(row.guildId, row.targetId, configVersion);
    const eventId = readEventId(row.metadata);
    const existing = states.get(key);
    if (!existing) {
      states.set(key, {
        status,
        configVersion,
        observedAt: row.createdAt.toISOString(),
        consumer,
      });
      eventIds.set(key, eventId);
      continue;
    }

    // Rows are queried newest-first. Normally the first row wins, but Redis delivery and
    // Studio audit persistence run concurrently: a consumer can persist an apply ACK before Studio
    // persists the publish result for the same event. In that race, the terminal apply outcome
    // is authoritative even when its audit row has an earlier createdAt.
    const existingEventId = eventIds.get(key);
    if (
      eventId &&
      existingEventId === eventId &&
      !isApplyOutcome(existing.status) &&
      isApplyOutcome(status)
    ) {
      states.set(key, {
        status,
        configVersion,
        observedAt: row.createdAt.toISOString(),
        consumer,
      });
    }
  }

  return states;
}

export function pluginRuntimeOperationStateKey(
  guildId: string,
  pluginId: string,
  configVersion: number,
): string {
  return `${guildId}:${pluginId}:${configVersion}`;
}

export function pluginRuntimeConsumerOperationStateKey(
  guildId: string,
  pluginId: string,
  configVersion: number,
  consumer: PluginRuntimeConsumer,
): string {
  return `${guildId}:${pluginId}:${configVersion}:${consumer}`;
}

function runtimeStatusForEvent(event: string): PluginRuntimeDeliveryStatus | undefined {
  return RUNTIME_EVENT_STATUS[event as keyof typeof RUNTIME_EVENT_STATUS];
}

function readConfigVersion(metadata: unknown): number | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata['configVersion'];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function readEventId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata['eventId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function runtimeConsumerForMetadata(metadata: unknown): PluginRuntimeConsumer | undefined {
  if (!isRecord(metadata)) return DEFAULT_PLUGIN_RUNTIME_CONSUMER;
  const value = metadata['consumer'];
  if (value === undefined) return DEFAULT_PLUGIN_RUNTIME_CONSUMER;
  return isPluginRuntimeConsumer(value) ? value : undefined;
}

function isApplyOutcome(status: PluginRuntimeDeliveryStatus): boolean {
  return status === 'applied' || status === 'apply_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
