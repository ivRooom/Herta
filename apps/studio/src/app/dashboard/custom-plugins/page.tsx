import type { Metadata } from 'next';
import { getAllPluginManifests } from '@herta/plugin-catalog';
import {
  CustomPluginHubCatalog,
  type PluginHubCatalogItem,
} from '@/components/custom-plugin-hub-catalog';

export const metadata: Metadata = {
  title: 'Custom Plugin Hub | Herta Studio',
  description: 'Herta Pluginの機能、要求権限、依存関係、Command、Event購読を確認できます。',
};

export default function CustomPluginsPage() {
  const plugins: PluginHubCatalogItem[] = getAllPluginManifests().map((manifest) => ({
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

  return <CustomPluginHubCatalog plugins={plugins} />;
}
