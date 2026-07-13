import type { SlashCommand } from '../commands/registry.js';
import type { HertaPlugin } from '@herta/plugin-sdk';

export interface GuildEventHandler {
  event: string;
  handler(...args: unknown[]): Promise<void>;
}

export interface RuntimePluginEntry {
  pluginId: string;
  provideCommands?(config: Record<string, unknown>, guildId?: string): SlashCommand[];
  provideEvents?(config: Record<string, unknown>, guildId?: string): GuildEventHandler[];
  onEnable?(guildId: string, config: Record<string, unknown>): Promise<void>;
  onDisable?(guildId: string, config: Record<string, unknown>): Promise<void>;
  /** SDK Plugin 本体。静的に登録された実装だけを保持する。 */
  plugin?: HertaPlugin<Record<string, unknown>>;
}

export type RuntimePluginContextFactory = (
  plugin: HertaPlugin<Record<string, unknown>>,
  guildId: string,
  config: Record<string, unknown>,
) => Parameters<NonNullable<HertaPlugin<Record<string, unknown>>['onEnable']>>[0];

export interface LoadedGuildPlugins {
  commands: SlashCommand[];
  events: GuildEventHandler[];
  loaded: string[];
  skipped: { pluginId: string; reason: string }[];
}
