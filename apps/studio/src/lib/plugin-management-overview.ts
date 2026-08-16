import { getPluginOperationsInventory } from './plugin-operations.ts';

export async function getPluginManagementOverview(guildIds: readonly string[]) {
  const inventory = await getPluginOperationsInventory(guildIds);

  return {
    availablePlugins: inventory.availablePlugins,
    installedInstances: inventory.configuredInstances,
    enabledInstances: inventory.enabledInstances,
    attentionInstances: inventory.attentionInstances,
    byGuild: Object.fromEntries(
      Object.entries(inventory.byGuild).map(([guildId, summary]) => [
        guildId,
        {
          installed: summary.configured,
          enabled: summary.enabled,
          attention: summary.attention,
        },
      ]),
    ),
  };
}
