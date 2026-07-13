export const PLUGIN_RUNTIME_EVENT_CHANNEL = 'herta:plugin-runtime:v1';
export const PLUGIN_RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export type PluginRuntimeEventType = 'enabled' | 'disabled' | 'config_updated';

export interface PluginRuntimeEvent {
  schemaVersion: typeof PLUGIN_RUNTIME_EVENT_SCHEMA_VERSION;
  eventId: string;
  guildId: string;
  pluginId: string;
  configVersion: number;
  eventType: PluginRuntimeEventType;
  occurredAt: string;
}

export function createPluginRuntimeEvent(input: {
  guildId: string;
  pluginId: string;
  configVersion: number;
  eventType: PluginRuntimeEventType;
  occurredAt?: Date;
}): PluginRuntimeEvent {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  return {
    schemaVersion: PLUGIN_RUNTIME_EVENT_SCHEMA_VERSION,
    eventId: `${input.guildId}:${input.pluginId}:${input.configVersion}:${input.eventType}:${occurredAt}`,
    guildId: input.guildId,
    pluginId: input.pluginId,
    configVersion: input.configVersion,
    eventType: input.eventType,
    occurredAt,
  };
}

export function parsePluginRuntimeEvent(value: string): PluginRuntimeEvent | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!isRecord(candidate)) return undefined;
  if (candidate['schemaVersion'] !== PLUGIN_RUNTIME_EVENT_SCHEMA_VERSION) return undefined;
  if (!isNonEmptyString(candidate['eventId'])) return undefined;
  if (!isNonEmptyString(candidate['guildId'])) return undefined;
  if (!isNonEmptyString(candidate['pluginId'])) return undefined;
  if (!Number.isSafeInteger(candidate['configVersion']) || Number(candidate['configVersion']) < 0)
    return undefined;
  if (!isPluginRuntimeEventType(candidate['eventType'])) return undefined;
  if (!isNonEmptyString(candidate['occurredAt']) || Number.isNaN(Date.parse(candidate['occurredAt'])))
    return undefined;

  return candidate as unknown as PluginRuntimeEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPluginRuntimeEventType(value: unknown): value is PluginRuntimeEventType {
  return value === 'enabled' || value === 'disabled' || value === 'config_updated';
}
