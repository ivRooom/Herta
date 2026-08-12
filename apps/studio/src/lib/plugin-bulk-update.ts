export type PluginBulkUpdateItem = {
  pluginId: string;
  enabled: boolean;
};

export type PluginBulkUpdateRequest = {
  updates: PluginBulkUpdateItem[];
};

const MAX_BULK_PLUGIN_UPDATES = 100;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function parsePluginBulkUpdateRequest(value: unknown): PluginBulkUpdateRequest | null {
  if (!isRecord(value) || !Array.isArray(value.updates)) return null;
  if (value.updates.length === 0 || value.updates.length > MAX_BULK_PLUGIN_UPDATES) return null;

  const seen = new Set<string>();
  const updates: PluginBulkUpdateItem[] = [];

  for (const candidate of value.updates) {
    if (!isRecord(candidate)) return null;
    if (typeof candidate.pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(candidate.pluginId))
      return null;
    if (typeof candidate.enabled !== 'boolean') return null;
    if (seen.has(candidate.pluginId)) return null;

    seen.add(candidate.pluginId);
    updates.push({ pluginId: candidate.pluginId, enabled: candidate.enabled });
  }

  return { updates };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
