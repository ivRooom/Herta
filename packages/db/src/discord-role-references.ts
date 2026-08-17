import type { Prisma, PrismaClient } from '@prisma/client';

const MAX_REFERENCE_RESULTS = 20;
const MAX_JSON_REFERENCE_DEPTH = 16;

export interface HertaDiscordRoleReferenceSnapshot {
  settings: {
    modRoleIds: string[];
    adminRoleIds: string[];
    settingsJson: Prisma.JsonValue;
  } | null;
  plugins: Array<{
    pluginId: string;
    config: Prisma.JsonValue;
  }>;
}

export async function findHertaDiscordRoleReferences(
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

  return collectHertaDiscordRoleReferences({ settings, plugins }, roleId);
}

export function collectHertaDiscordRoleReferences(
  snapshot: HertaDiscordRoleReferenceSnapshot,
  roleId: string,
): string[] {
  const references = new Set<string>();

  if (snapshot.settings?.modRoleIds.includes(roleId)) {
    references.add('GuildSettings.modRoleIds');
  }
  if (snapshot.settings?.adminRoleIds.includes(roleId)) {
    references.add('GuildSettings.adminRoleIds');
  }

  const settingsJson = removeAutoCleanedStudioRolePolicies(snapshot.settings?.settingsJson);
  if (containsExactJsonStringValue(settingsJson, roleId)) {
    references.add('GuildSettings.settingsJson');
  }

  for (const plugin of snapshot.plugins) {
    if (containsExactJsonStringValue(plugin.config, roleId)) {
      references.add(`Plugin:${plugin.pluginId}`);
    }
    if (references.size >= MAX_REFERENCE_RESULTS) break;
  }

  return [...references].slice(0, MAX_REFERENCE_RESULTS);
}

export function containsExactJsonStringValue(value: unknown, target: string, depth = 0): boolean {
  if (depth > MAX_JSON_REFERENCE_DEPTH) return false;
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) {
    return value.some((item) => containsExactJsonStringValue(item, target, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => containsExactJsonStringValue(item, target, depth + 1));
}

function removeAutoCleanedStudioRolePolicies(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const root = { ...value };
  if (!isRecord(root.studioAccess)) return root;

  const studioAccess = { ...root.studioAccess };
  delete studioAccess.rolePolicies;
  root.studioAccess = studioAccess;
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
