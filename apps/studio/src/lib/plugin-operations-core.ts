export type PluginOperationStatus = 'attention' | 'healthy' | 'paused';
export type PluginRuntimeDeliveryStatus =
  | 'published'
  | 'applied'
  | 'publish_failed'
  | 'apply_failed';
export type PluginOperationAttentionReason =
  | 'config_invalid'
  | 'runtime_publish_failed'
  | 'runtime_apply_failed'
  | 'runtime_apply_delayed';

export interface PluginOperationInventoryRow {
  guildId: string;
  pluginId: string;
  pluginName: string;
  enabled: boolean;
  configValid: boolean;
  configVersion: number;
  installedAt: string;
  updatedAt: string;
  runtimeStatus?: PluginRuntimeDeliveryStatus;
  runtimeConfigVersion?: number;
  runtimeObservedAt?: string;
}

export interface PluginOperationItem extends PluginOperationInventoryRow {
  status: PluginOperationStatus;
  attentionReason: PluginOperationAttentionReason | null;
}

export interface PluginOperationGuildSummary {
  configured: number;
  enabled: number;
  healthy: number;
  attention: number;
  paused: number;
  notConfigured: number;
}

export interface PluginOperationsInventory {
  availablePlugins: number;
  totalSlots: number;
  configuredInstances: number;
  enabledInstances: number;
  healthyInstances: number;
  attentionInstances: number;
  pausedInstances: number;
  notConfiguredInstances: number;
  byGuild: Record<string, PluginOperationGuildSummary>;
  entries: PluginOperationItem[];
}

export const PLUGIN_RUNTIME_APPLY_DELAY_MS = 120_000;

const STATUS_PRIORITY: Record<PluginOperationStatus, number> = {
  attention: 0,
  healthy: 1,
  paused: 2,
};

export function summarizePluginOperations(
  guildIds: readonly string[],
  availablePlugins: number,
  rows: readonly PluginOperationInventoryRow[],
  nowMs = Date.now(),
): PluginOperationsInventory {
  const normalizedAvailablePlugins = Number.isSafeInteger(availablePlugins)
    ? Math.max(0, availablePlugins)
    : 0;
  const uniqueGuildIds = [...new Set(guildIds)];
  const guildIdSet = new Set(uniqueGuildIds);
  const byGuild: Record<string, PluginOperationGuildSummary> = Object.fromEntries(
    uniqueGuildIds.map((guildId) => [
      guildId,
      {
        configured: 0,
        enabled: 0,
        healthy: 0,
        attention: 0,
        paused: 0,
        notConfigured: normalizedAvailablePlugins,
      },
    ]),
  );

  const entries: PluginOperationItem[] = [];
  for (const row of rows) {
    if (!guildIdSet.has(row.guildId)) continue;

    const attentionReason = resolvePluginOperationAttentionReason(row, nowMs);
    const status = resolvePluginOperationStatus(row.enabled, row.configValid, attentionReason);
    entries.push({ ...row, status, attentionReason });

    const summary = byGuild[row.guildId];
    if (!summary) continue;
    summary.configured += 1;
    summary.notConfigured = Math.max(0, normalizedAvailablePlugins - summary.configured);

    if (row.enabled) {
      summary.enabled += 1;
      if (status === 'attention') summary.attention += 1;
      else summary.healthy += 1;
    } else {
      summary.paused += 1;
    }
  }

  entries.sort((left, right) => {
    const statusDiff = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (statusDiff !== 0) return statusDiff;

    const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;
    return left.pluginName.localeCompare(right.pluginName, 'ja');
  });

  const guildSummaries = Object.values(byGuild);
  const configuredInstances = guildSummaries.reduce((sum, item) => sum + item.configured, 0);
  const enabledInstances = guildSummaries.reduce((sum, item) => sum + item.enabled, 0);
  const healthyInstances = guildSummaries.reduce((sum, item) => sum + item.healthy, 0);
  const attentionInstances = guildSummaries.reduce((sum, item) => sum + item.attention, 0);
  const pausedInstances = guildSummaries.reduce((sum, item) => sum + item.paused, 0);
  const totalSlots = uniqueGuildIds.length * normalizedAvailablePlugins;

  return {
    availablePlugins: normalizedAvailablePlugins,
    totalSlots,
    configuredInstances,
    enabledInstances,
    healthyInstances,
    attentionInstances,
    pausedInstances,
    notConfiguredInstances: Math.max(0, totalSlots - configuredInstances),
    byGuild,
    entries,
  };
}

export function resolvePluginOperationAttentionReason(
  row: PluginOperationInventoryRow,
  nowMs = Date.now(),
): PluginOperationAttentionReason | null {
  if (!row.enabled) return null;
  if (!row.configValid) return 'config_invalid';

  if (
    row.runtimeStatus === undefined ||
    row.runtimeConfigVersion === undefined ||
    row.runtimeConfigVersion !== row.configVersion
  ) {
    return null;
  }

  if (row.runtimeStatus === 'publish_failed') return 'runtime_publish_failed';
  if (row.runtimeStatus === 'apply_failed') return 'runtime_apply_failed';
  if (row.runtimeStatus !== 'published' || !row.runtimeObservedAt) return null;

  const observedAt = Date.parse(row.runtimeObservedAt);
  if (!Number.isFinite(observedAt)) return null;
  return nowMs - observedAt >= PLUGIN_RUNTIME_APPLY_DELAY_MS ? 'runtime_apply_delayed' : null;
}

export function resolvePluginOperationStatus(
  enabled: boolean,
  configValid: boolean,
  attentionReason: PluginOperationAttentionReason | null = configValid ? null : 'config_invalid',
): PluginOperationStatus {
  if (!enabled) return 'paused';
  return attentionReason ? 'attention' : 'healthy';
}
