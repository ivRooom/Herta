export interface GuildPluginManagementSummary {
  installed: number;
  enabled: number;
}

export interface PluginManagementOverview {
  availablePlugins: number;
  enabledInstances: number;
  installedInstances: number;
  byGuild: Record<string, GuildPluginManagementSummary>;
}

export interface PluginManagementRow {
  guildId: string;
  enabled: boolean;
}

export function summarizePluginManagementRows(
  guildIds: readonly string[],
  availablePlugins: number,
  rows: readonly PluginManagementRow[],
): PluginManagementOverview {
  const byGuild = Object.fromEntries(
    [...new Set(guildIds)].map((guildId) => [guildId, { installed: 0, enabled: 0 }]),
  ) as Record<string, GuildPluginManagementSummary>;

  let installedInstances = 0;
  let enabledInstances = 0;

  for (const row of rows) {
    const summary = byGuild[row.guildId];
    if (!summary) continue;

    summary.installed += 1;
    installedInstances += 1;

    if (row.enabled) {
      summary.enabled += 1;
      enabledInstances += 1;
    }
  }

  return {
    availablePlugins,
    enabledInstances,
    installedInstances,
    byGuild,
  };
}
