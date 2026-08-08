'use client';

import type { GuildConfigurationOptions } from '@/lib/bot-guild-options';
import { PluginConfigStudioForm } from './plugin-config-studio-form';

export function PluginConfigForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
  discordOptions,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
  discordOptions?: GuildConfigurationOptions | null;
}) {
  return (
    <PluginConfigStudioForm
      guildId={guildId}
      pluginId={pluginId}
      initialEnabled={initialEnabled}
      initialConfig={initialConfig}
      schema={schema}
      discordOptions={discordOptions}
    />
  );
}
