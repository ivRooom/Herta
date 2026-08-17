import type { CommandDefinition } from '@herta/shared';
import type { SlashCommand } from '../commands/registry.js';

export type GuildCommandCatalogSource = 'core' | 'plugin';

export interface GuildCommandCatalogEntry extends CommandDefinition {
  source: GuildCommandCatalogSource;
}

export interface GuildCommandCatalog {
  guildId: string;
  commands: GuildCommandCatalogEntry[];
}

function cloneDefinition(command: SlashCommand, source: GuildCommandCatalogSource): GuildCommandCatalogEntry {
  const definition = command.definition;
  return {
    name: definition.name,
    description: definition.description,
    source,
    ...(definition.options ? { options: structuredClone(definition.options) } : {}),
    ...(definition.subcommands ? { subcommands: structuredClone(definition.subcommands) } : {}),
  };
}

export function buildGuildCommandCatalog(
  guildId: string,
  coreCommands: readonly SlashCommand[],
  pluginCommands: readonly SlashCommand[],
): GuildCommandCatalog {
  const commands = [
    ...coreCommands.map((command) => cloneDefinition(command, 'core')),
    ...pluginCommands.map((command) => cloneDefinition(command, 'plugin')),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return { guildId, commands };
}
