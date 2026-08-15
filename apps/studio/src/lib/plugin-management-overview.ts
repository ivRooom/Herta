import { getAllPluginManifests } from '@herta/plugin-catalog';
import { prisma } from '@/lib/db';

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

export async function getPluginManagementOverview(
  guildIds: readonly string[],
): Promise<PluginManagementOverview> {
  const manifests = getAllPluginManifests();
  const pluginIds = manifests.map((manifest) => manifest.id);
  const byGuild = Object.fromEntries(
    guildIds.map((guildId) => [guildId, { installed: 0, enabled: 0 }]),
  ) as Record<string, GuildPluginManagementSummary>;

  if (guildIds.length === 0 || pluginIds.length === 0) {
    return {
      availablePlugins: manifests.length,
      enabledInstances: 0,
      installedInstances: 0,
      byGuild,
    };
  }

  const rows = await prisma.guildPlugin.findMany({
    where: {
      guildId: { in: [...guildIds] },
      pluginId: { in: pluginIds },
    },
    select: {
      guildId: true,
      enabled: true,
    },
  });

  let enabledInstances = 0;
  for (const row of rows) {
    const summary = byGuild[row.guildId];
    if (!summary) continue;
    summary.installed += 1;
    if (row.enabled) {
      summary.enabled += 1;
      enabledInstances += 1;
    }
  }

  return {
    availablePlugins: manifests.length,
    enabledInstances,
    installedInstances: rows.length,
    byGuild,
  };
}
