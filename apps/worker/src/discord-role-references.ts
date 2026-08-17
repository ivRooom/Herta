import type { PrismaClient } from '@herta/db';
import { containsExactJsonStringValue } from '@herta/shared';

export async function findHertaRoleReferences(
  prisma: PrismaClient,
  guildId: string,
  roleId: string,
): Promise<string[]> {
  const [settings, plugins] = await Promise.all([
    prisma.guildSettings.findUnique({
      where: { guildId },
      select: { modRoleIds: true, adminRoleIds: true, settingsJson: true },
    }),
    prisma.guildPlugin.findMany({
      where: { guildId },
      select: { pluginId: true, config: true },
    }),
  ]);

  const references: string[] = [];
  if (settings?.modRoleIds.includes(roleId)) references.push('GuildSettings.modRoleIds');
  if (settings?.adminRoleIds.includes(roleId)) references.push('GuildSettings.adminRoleIds');
  if (containsNonPolicySettingsReference(settings?.settingsJson, roleId)) {
    references.push('GuildSettings.settingsJson');
  }
  for (const plugin of plugins) {
    if (containsExactJsonStringValue(plugin.config, roleId)) {
      references.push(`Plugin:${plugin.pluginId}`);
    }
  }
  return references.slice(0, 20);
}

function containsNonPolicySettingsReference(value: unknown, roleId: string): boolean {
  if (!isRecord(value)) return containsExactJsonStringValue(value, roleId);
  const { studioAccess: _studioAccess, ...nonPolicySettings } = value;
  return containsExactJsonStringValue(nonPolicySettings, roleId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
