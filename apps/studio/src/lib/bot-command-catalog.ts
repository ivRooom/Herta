import { resolveBotHealthRequestTimeoutMs } from './bot-health.ts';

const MIN_INTERNAL_API_SECRET_LENGTH = 32;

export type BotCommandCatalogSource = 'core' | 'plugin';
export type BotCommandCatalogOptionType =
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

export interface BotCommandCatalogChoice {
  name: string;
  value: string | number;
}

export interface BotCommandCatalogOption {
  name: string;
  description: string;
  type: BotCommandCatalogOptionType;
  required: boolean;
  choices?: BotCommandCatalogChoice[];
  minValue?: number;
  maxValue?: number;
  options?: BotCommandCatalogOption[];
}

export interface BotCommandCatalogEntry {
  id: string;
  name: string;
  description: string;
  source: BotCommandCatalogSource;
  options: BotCommandCatalogOption[];
}

export interface BotGuildCommandCatalog {
  guildId: string;
  commands: BotCommandCatalogEntry[];
}

export class BotCommandCatalogError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Bot command catalog request failed (${status})`);
    this.name = 'BotCommandCatalogError';
    this.status = status;
  }
}

export async function getBotGuildCommandCatalog(
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BotGuildCommandCatalog> {
  const endpoint = resolveBotCommandCatalogUrl(guildId);
  const secret = process.env['BOT_INTERNAL_API_SECRET']?.trim();
  if (!endpoint || !secret || secret.length < MIN_INTERNAL_API_SECRET_LENGTH) {
    throw new BotCommandCatalogError(503);
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(resolveBotHealthRequestTimeoutMs() + 8_000),
    });
  } catch {
    throw new BotCommandCatalogError(502);
  }

  if (!response.ok) {
    if (response.status === 404) throw new BotCommandCatalogError(404);
    if (response.status === 429) throw new BotCommandCatalogError(429);
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      throw new BotCommandCatalogError(503);
    }
    throw new BotCommandCatalogError(502);
  }

  const payload = await response.json().catch(() => null);
  const catalog = parseCatalog(payload);
  if (!catalog) throw new BotCommandCatalogError(502);
  return catalog;
}

function resolveBotCommandCatalogUrl(guildId: string): string | null {
  const healthUrl = process.env['BOT_HEALTH_URL']?.trim();
  if (!healthUrl || !/^\d{17,20}$/u.test(guildId)) return null;

  try {
    const url = new URL(healthUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `/internal/guilds/${guildId}/commands`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseCatalog(value: unknown): BotGuildCommandCatalog | null {
  if (!isRecord(value) || !isSnowflake(value.guildId) || !Array.isArray(value.commands)) {
    return null;
  }

  const commands: BotCommandCatalogEntry[] = [];
  for (const item of value.commands) {
    const parsed = parseCommand(item);
    if (!parsed) return null;
    commands.push(parsed);
  }
  return { guildId: value.guildId, commands };
}

function parseCommand(value: unknown): BotCommandCatalogEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isSnowflake(value.id) ||
    !isCommandName(value.name) ||
    typeof value.description !== 'string' ||
    (value.source !== 'core' && value.source !== 'plugin') ||
    !Array.isArray(value.options)
  ) {
    return null;
  }

  const options = parseOptions(value.options);
  if (!options) return null;
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    source: value.source,
    options,
  };
}

function parseOptions(value: unknown[]): BotCommandCatalogOption[] | null {
  const result: BotCommandCatalogOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (
      !isCommandName(item.name) ||
      typeof item.description !== 'string' ||
      !isOptionType(item.type) ||
      typeof item.required !== 'boolean'
    ) {
      return null;
    }

    const choices = parseChoices(item.choices);
    if (!choices) return null;
    const nested =
      item.options === undefined
        ? []
        : Array.isArray(item.options)
          ? parseOptions(item.options)
          : null;
    if (!nested) return null;

    result.push({
      name: item.name,
      description: item.description,
      type: item.type,
      required: item.required,
      ...(choices.length > 0 ? { choices } : {}),
      ...(typeof item.minValue === 'number' ? { minValue: item.minValue } : {}),
      ...(typeof item.maxValue === 'number' ? { maxValue: item.maxValue } : {}),
      ...(nested.length > 0 ? { options: nested } : {}),
    });
  }
  return result;
}

function parseChoices(value: unknown): BotCommandCatalogChoice[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: BotCommandCatalogChoice[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string') return null;
    if (typeof item.value !== 'string' && typeof item.value !== 'number') return null;
    result.push({ name: item.name, value: item.value });
  }
  return result;
}

function isOptionType(value: unknown): value is BotCommandCatalogOptionType {
  return (
    typeof value === 'string' &&
    [
      'subcommand',
      'subcommand-group',
      'string',
      'integer',
      'boolean',
      'user',
      'channel',
      'role',
      'mentionable',
      'number',
      'attachment',
      'unknown',
    ].includes(value)
  );
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
