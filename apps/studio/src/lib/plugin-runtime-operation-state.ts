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
}

export function buildPluginRuntimeOperationStateMap(
  rows: readonly PluginRuntimeAuditRow[],
): Map<string, PluginRuntimeOperationState> {
  const states = new Map<string, PluginRuntimeOperationState>();

  for (const row of rows) {
    if (!row.targetId) continue;
    const status = runtimeStatusForEvent(row.event);
    if (!status) continue;
    const configVersion = readConfigVersion(row.metadata);
    if (configVersion === undefined) continue;

    const key = pluginRuntimeOperationStateKey(row.guildId, row.targetId, configVersion);
    if (states.has(key)) continue;
    states.set(key, {
      status,
      configVersion,
      observedAt: row.createdAt.toISOString(),
    });
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

function runtimeStatusForEvent(event: string): PluginRuntimeDeliveryStatus | undefined {
  return RUNTIME_EVENT_STATUS[event as keyof typeof RUNTIME_EVENT_STATUS];
}

function readConfigVersion(metadata: unknown): number | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata['configVersion'];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
