import type { Metadata } from 'next';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import {
  CustomPluginHubCatalog,
  type PluginHubCatalogItem,
} from '@/components/custom-plugin-hub-catalog';
import {
  PluginHubGuildPreflight,
  type PluginHubGuildPluginState,
} from '@/components/plugin-hub-guild-preflight';
import { DiscordApiError, type ManageableGuild } from '@/lib/discord';
import { getManageableGuilds } from '@/lib/guilds';
import { listGuildPlugins } from '@/lib/guild-plugins';
import { getDiscordAccessToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Custom Plugin Hub | Herta Studio',
  description: 'Herta Pluginの機能、要求権限、依存関係、Command、Event購読を確認できます。',
};

export const dynamic = 'force-dynamic';

export default async function CustomPluginsPage({
  searchParams,
}: {
  searchParams: Promise<{ guild?: string }>;
}) {
  const manifests = getAllPluginManifests();
  const plugins: PluginHubCatalogItem[] = manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    authorName: manifest.author.name,
    ...(manifest.author.url ? { authorUrl: manifest.author.url } : {}),
    ...(manifest.minHertaVersion ? { minHertaVersion: manifest.minHertaVersion } : {}),
    permissions: manifest.permissions.map((permission) => ({ ...permission })),
    dependencies: manifest.dependencies.map((dependency) => ({ ...dependency })),
    events: [...manifest.events],
    commands: manifest.commands.map((command) => ({
      name: command.name,
      description: command.description,
    })),
    hasConfigSchema: Object.keys(manifest.configSchema).length > 0,
  }));

  const { guild: requestedGuildId } = await searchParams;
  const preflight = await loadGuildPreflight(requestedGuildId);

  return (
    <div className="space-y-7">
      <PluginHubGuildPreflight {...preflight} />
      <CustomPluginHubCatalog plugins={plugins} />
    </div>
  );
}

async function loadGuildPreflight(requestedGuildId: string | undefined) {
  const accessToken = await getDiscordAccessToken();
  if (!accessToken) {
    return {
      guilds: [],
      plugins: [],
      unavailableReason: 'Discordセッションを再接続するとGuild単位の導入状態を確認できます。',
    };
  }

  const manageableGuilds = await loadManageableGuildsForPreflight(accessToken);
  if ('unavailableReason' in manageableGuilds) return manageableGuilds;

  const guilds = manageableGuilds.guilds;
  const options = guilds.map((guild) => ({ id: guild.id, name: guild.name }));
  const selectedGuild = requestedGuildId
    ? guilds.find((guild) => guild.id === requestedGuildId)
    : undefined;

  if (!selectedGuild) {
    return {
      guilds: options,
      plugins: [],
      ...(requestedGuildId
        ? { unavailableReason: '指定されたGuildは管理対象ではないためPreflightを表示しません。' }
        : {}),
    };
  }

  const guildPlugins = await listGuildPlugins(selectedGuild.id);
  const stateById = new Map(guildPlugins.map((plugin) => [plugin.manifest.id, plugin]));
  const pluginStates: PluginHubGuildPluginState[] = guildPlugins.map((plugin) => ({
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    installed: plugin.installed,
    enabled: plugin.enabled,
    hasConfigSchema: Object.keys(plugin.manifest.configSchema).length > 0,
    requiredPermissionCount: plugin.manifest.permissions.length,
    dependencies: plugin.manifest.dependencies.map((dependency) => {
      const dependencyState = stateById.get(dependency.pluginId);
      return {
        pluginId: dependency.pluginId,
        optional: dependency.optional ?? false,
        installed: dependencyState?.installed ?? false,
        enabled: dependencyState?.enabled ?? false,
      };
    }),
  }));

  return {
    guilds: options,
    selectedGuildId: selectedGuild.id,
    selectedGuildName: selectedGuild.name,
    plugins: pluginStates,
  };
}

async function loadManageableGuildsForPreflight(
  accessToken: string,
): Promise<{ guilds: ManageableGuild[] } | { guilds: []; plugins: []; unavailableReason: string }> {
  try {
    return { guilds: await getManageableGuilds(accessToken) };
  } catch (error) {
    if (error instanceof DiscordApiError) {
      const unavailableReason =
        error.status === 401
          ? 'Discordセッションの有効期限が切れています。再ログインするとPreflightを利用できます。'
          : error.status === 429
            ? 'Discord APIがレート制限中のためGuild状態を取得できません。Catalog自体は引き続き利用できます。'
            : 'Discord APIからGuild状態を取得できません。Catalog自体は引き続き利用できます。';
      return { guilds: [], plugins: [], unavailableReason };
    }

    if (error instanceof TypeError) {
      return {
        guilds: [],
        plugins: [],
        unavailableReason:
          'Discord APIへの通信に失敗したためGuild状態を取得できません。Catalog自体は引き続き利用できます。',
      };
    }

    throw error;
  }
}
