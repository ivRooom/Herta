import { PrismaClient } from '@herta/db';
import { autoResponseManifest } from '@herta/plugin-auto-response/manifest';
import { dailyContentManifest } from '@herta/plugin-daily-content/manifest';
import { lfgManifest } from '@herta/plugin-lfg/manifest';
import { moderationManifest } from '@herta/plugin-moderation/manifest';
import { quoteManifest } from '@herta/plugin-quote/manifest';
import { teamSplitManifest } from '@herta/plugin-team-split/manifest';
import type { PluginManifest } from '@herta/shared';

export { quotePlugin } from '@herta/plugin-quote';

const pluginManifests: PluginManifest[] = [
  autoResponseManifest,
  dailyContentManifest,
  lfgManifest,
  moderationManifest,
  quoteManifest,
  teamSplitManifest,
];

const pluginManifestMap = new Map(pluginManifests.map((manifest) => [manifest.id, manifest]));

export function getPluginManifest(id: string): PluginManifest | undefined {
  return pluginManifestMap.get(id);
}

export function getAllPluginManifests(): PluginManifest[] {
  return [...pluginManifests];
}

export interface EnabledPlugin {
  manifest: PluginManifest;
  config: Record<string, unknown>;
  configVersion: number;
}

/**
 * Guildで有効な公式Pluginと検証済み設定を返す。
 * RuntimeはDB内のコードやpackage名を評価せず、静的Registryだけから実装を解決する。
 */
export async function getEnabledPlugins(
  prisma: PrismaClient,
  guildId: string,
): Promise<EnabledPlugin[]> {
  const rows = await prisma.guildPlugin.findMany({
    where: { guildId, enabled: true },
    include: { plugin: true },
  });

  return rows.flatMap((row) => {
    const manifest = getPluginManifest(row.pluginId);
    if (!manifest) return [];

    return [
      {
        manifest,
        config: isRecord(row.config) ? row.config : {},
        configVersion: row.configVersion,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
