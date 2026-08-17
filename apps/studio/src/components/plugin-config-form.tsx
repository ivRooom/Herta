'use client';

import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import type { PluginConfigStudioAccess } from '@/lib/studio-plugin-permissions';
import { PluginConfigStudioForm } from './plugin-config-studio-form';

export function PluginConfigForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
  discordOptions,
  configAccess,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
  discordOptions?: GuildConfigurationOptions | null;
  configAccess: PluginConfigStudioAccess;
}) {
  return (
    <PluginConfigStudioForm
      guildId={guildId}
      pluginId={pluginId}
      initialEnabled={initialEnabled}
      initialConfig={initialConfig}
      schema={schema}
      discordOptions={discordOptions}
      configAccess={configAccess}
    />
  );
}
