'use client';

import { PluginConfigStudioForm } from './plugin-config-studio-form';

export function PluginConfigForm({
  guildId,
  pluginId,
  initialEnabled,
  initialConfig,
  schema,
}: {
  guildId: string;
  pluginId: string;
  initialEnabled: boolean;
  initialConfig: Record<string, unknown>;
  schema: Record<string, unknown>;
}) {
  return (
    <PluginConfigStudioForm
      guildId={guildId}
      pluginId={pluginId}
      initialEnabled={initialEnabled}
      initialConfig={initialConfig}
      schema={schema}
    />
  );
}
