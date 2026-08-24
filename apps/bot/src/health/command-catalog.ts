import { communityActivityCommands } from '../commands/community-activity.js';
import { coreInformationCommands } from '../commands/core-info.js';
import { pingCommand } from '../commands/ping.js';
import { PLUGIN_OWNED_COMMAND_NAMES } from '../commands/registry.js';
import { coreUtilityV3Commands } from '../commands/utility-v3.js';
import { coreUtilityV4Commands } from '../commands/utility-v4.js';
import { coreUtilityV5Commands } from '../commands/utility-v5.js';

export type GuildCommandCatalogSource = 'core' | 'plugin';

export type GuildCommandCatalogOptionType =
  | 'subcommand'
  | 'subcommand-group'
  | 'string'
  | 'integer'
  | 'boolean'
  | 'user'
  | 'channel'
  | 'role'
  | 'mentionable'
  | 'number'
  | 'attachment'
  | 'unknown';

export interface GuildCommandCatalogChoice {
  name: string;
  value: string | number;
}

export interface GuildCommandCatalogOption {
  name: string;
  description: string;
  type: GuildCommandCatalogOptionType;
  required: boolean;
  choices?: GuildCommandCatalogChoice[];
  minValue?: number;
  maxValue?: number;
  options?: GuildCommandCatalogOption[];
}

export interface GuildCommandCatalogEntry {
  id: string;
  name: string;
  description: string;
  source: GuildCommandCatalogSource;
  options: GuildCommandCatalogOption[];
}

export interface GuildCommandCatalog {
  guildId: string;
  commands: GuildCommandCatalogEntry[];
}

export class GuildCommandCatalogError extends Error {
  readonly status: number;

  constructor(status: number, message = 'Guild command catalog request failed') {
    super(message);
    this.name = 'GuildCommandCatalogError';
    this.status = status;
  }
}

const CORE_COMMAND_NAMES = new Set(
  [
    ...coreInformationCommands,
    ...coreUtilityV3Commands,
    ...coreUtilityV4Commands,
    ...coreUtilityV5Commands,
    ...communityActivityCommands,
    pingCommand,
  ]
    .map((command) => command.definition.name)
    .filter((name) => !PLUGIN_OWNED_COMMAND_NAMES.has(name)),
);

const DISCORD_OPTION_TYPES: Record<number, GuildCommandCatalogOptionType> = {
  1: 'subcommand',
  2: 'subcommand-group',
  3: 'string',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  9: 'mentionable',
  10: 'number',
  11: 'attachment',
};

export async function fetchGuildCommandCatalog(
  botToken: string,
  applicationId: string,
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GuildCommandCatalog> {
  if (!botToken.trim() || !isSnowflake(applicationId) || !isSnowflake(guildId)) {
    throw new GuildCommandCatalogError(503, 'Discord command catalog is not configured');
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bot ${botToken.trim()}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(7_000),
      },
    );
  } catch {
    throw new GuildCommandCatalogError(503, 'Discord command catalog is unavailable');
  }

  if (!response.ok) {
    if (response.status === 404) throw new GuildCommandCatalogError(404, 'Guild not found');
    if (response.status === 429) throw new GuildCommandCatalogError(429, 'Discord rate limited');
    throw new GuildCommandCatalogError(503, 'Discord command catalog request failed');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GuildCommandCatalogError(502, 'Discord returned invalid JSON');
  }

  if (!Array.isArray(payload)) {
    throw new GuildCommandCatalogError(502, 'Discord returned an invalid command catalog');
  }

  const commands: GuildCommandCatalogEntry[] = [];
  for (const item of payload) {
    const command = parseCommand(item);
    if (!command) {
      throw new GuildCommandCatalogError(502, 'Discord returned an invalid command entry');
    }
    commands.push(command);
  }

  commands.sort((a, b) => a.name.localeCompare(b.name));
  return { guildId, commands };
}

export function isCoreCommandName(name: string): boolean {
  return CORE_COMMAND_NAMES.has(name);
}

function parseCommand(value: unknown): GuildCommandCatalogEntry | null {
  if (!isRecord(value)) return null;
  const { id, name, description } = value;
  if (!isSnowflake(id) || !isCommandName(name) || typeof description !== 'string') return null;

  const options = parseOptions(value.options);
  if (!options) return null;

  return {
    id,
    name,
    description,
    source: isCoreCommandName(name) ? 'core' : 'plugin',
    options,
  };
}

function parseOptions(value: unknown): GuildCommandCatalogOption[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const options: GuildCommandCatalogOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { name, description, type } = item;
    if (!isCommandName(name) || typeof description !== 'string' || typeof type !== 'number') {
      return null;
    }

    const nested = parseOptions(item.options);
    if (!nested) return null;
    const choices = parseChoices(item.choices);
    if (!choices) return null;

    options.push({
      name,
      description,
      type: DISCORD_OPTION_TYPES[type] ?? 'unknown',
      required: item.required === true,
      ...(choices.length > 0 ? { choices } : {}),
      ...(typeof item.min_value === 'number' ? { minValue: item.min_value } : {}),
      ...(typeof item.max_value === 'number' ? { maxValue: item.max_value } : {}),
      ...(nested.length > 0 ? { options: nested } : {}),
    });
  }
  return options;
}

function parseChoices(value: unknown): GuildCommandCatalogChoice[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const choices: GuildCommandCatalogChoice[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string') return null;
    if (typeof item.value !== 'string' && typeof item.value !== 'number') return null;
    choices.push({ name: item.name, value: item.value });
  }
  return choices;
}

function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/u.test(value);
}

function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,32}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
