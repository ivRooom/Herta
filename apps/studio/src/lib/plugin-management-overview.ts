import { getAllPluginManifests } from '@herta/plugin-catalog';
import { prisma } from '@/lib/db';
import { summarizePluginManagementRows } from './plugin-management-summary.ts';

export async function getPluginManagementOverview(guildIds: readonly string[]) {
  const manifests = getAllPluginManifests();
  const pluginIds = manifests.map((manifest) => manifest.id);

  if (guildIds.length === 0 || pluginIds.length === 0) {
    return summarizePluginManagementRows(guildIds, manifests.length, []);
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

  return summarizePluginManagementRows(guildIds, manifests.length, rows);
}
