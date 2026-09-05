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
    <>
      {!discordOptions ? (
        <div
          className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
          role="status"
        >
          Discordのチャンネル・Role・Emoji候補をBotから取得できませんでした。候補pickerが空の場合は、Botの接続状態を確認してページを再読み込みしてください。
        </div>
      ) : null}
      <div className="[&>div>section]:overflow-visible [&>div>section>div:first-child]:rounded-t-2xl max-sm:[&>div>.sticky]:static max-sm:[&>div>.sticky]:bottom-auto max-sm:[&>div>.sticky]:z-auto">
        <PluginConfigStudioForm
          guildId={guildId}
          pluginId={pluginId}
          initialEnabled={initialEnabled}
          initialConfig={initialConfig}
          schema={schema}
          discordOptions={discordOptions}
          configAccess={configAccess}
        />
      </div>
    </>
  );
}
