import type { SlashCommand } from '../commands/registry.js';

export interface GuildEventHandler {
  event: string;
  handler(...args: unknown[]): Promise<void>;
}

export interface RuntimePluginEntry {
  pluginId: string;
  provideCommands?(config: Record<string, unknown>): SlashCommand[];
  provideEvents?(config: Record<string, unknown>): GuildEventHandler[];
}

export interface LoadedGuildPlugins {
  commands: SlashCommand[];
  events: GuildEventHandler[];
  loaded: string[];
  skipped: { pluginId: string; reason: string }[];
}
