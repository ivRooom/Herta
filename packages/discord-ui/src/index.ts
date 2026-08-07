export const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
} as const;

export type DiscordVisualTone =
  'info' | 'success' | 'warning' | 'high' | 'critical' | 'failed' | 'neutral';

export interface DiscordEmbedFieldPayload {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedPayload {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedFieldPayload[];
  footer?: { text: string };
  timestamp?: string;
  image?: { url: string };
  thumbnail?: { url: string };
}

export interface DiscordVisualMessagePayload {
  content?: string;
  embeds?: DiscordEmbedPayload[];
  allowedMentions: { parse: []; roles?: string[]; users?: string[] };
  flags?: number;
}

export const HERTA_DISCORD_COLORS: Record<DiscordVisualTone, number> = {
  info: 0x6d67e4,
  success: 0x57b98c,
  warning: 0xd99a39,
  high: 0xeb683a,
  critical: 0xec425b,
  failed: 0xca459a,
  neutral: 0x73819a,
};

export function buildDiscordVisualAssetUrl(input: {
  plugin: string;
  variant: string;
  baseUrl?: string | null;
}): string {
  const baseUrl = (input.baseUrl ?? 'https://herta.ivrm.jp').replace(/\/+$/u, '');
  const plugin = normalizeAssetSegment(input.plugin);
  const variant = normalizeAssetSegment(input.variant);
  return `${baseUrl}/api/discord-assets/${plugin}/${variant}`;
}

export function normalizeDiscordEmbedFields(
  fields: DiscordEmbedFieldPayload[] | undefined,
): DiscordEmbedFieldPayload[] | undefined {
  return fields
    ?.slice(0, DISCORD_EMBED_LIMITS.fields)
    .map(({ name, value, inline }) => discordEmbedField(name, value, inline));
}

export function discordEmbedField(
  name: string,
  value: string,
  inline = false,
): DiscordEmbedFieldPayload {
  return {
    name: truncateDiscordText(name, DISCORD_EMBED_LIMITS.fieldName),
    value: truncateDiscordText(value || '—', DISCORD_EMBED_LIMITS.fieldValue),
    ...(inline ? { inline: true } : {}),
  };
}

export function buildDiscordVisualEmbed(input: {
  title: string;
  description?: string | null;
  tone: DiscordVisualTone;
  plugin: string;
  variant?: string;
  baseUrl?: string | null;
  url?: string;
  fields?: DiscordEmbedFieldPayload[];
  footer?: string;
  timestamp?: Date | string | number;
  includeImage?: boolean;
}): DiscordEmbedPayload {
  const variant = input.variant ?? input.tone;
  return {
    title: truncateDiscordText(input.title, DISCORD_EMBED_LIMITS.title),
    ...(input.description
      ? {
          description: truncateDiscordText(input.description, DISCORD_EMBED_LIMITS.description),
        }
      : {}),
    color: HERTA_DISCORD_COLORS[input.tone],
    ...(input.url ? { url: input.url } : {}),
    fields: normalizeDiscordEmbedFields(input.fields),
    footer: {
      text: truncateDiscordText(
        input.footer ?? `Herta • ${humanizePluginName(input.plugin)}`,
        DISCORD_EMBED_LIMITS.footer,
      ),
    },
    timestamp: normalizeTimestamp(input.timestamp),
    ...(input.includeImage === false
      ? {}
      : {
          image: {
            url: buildDiscordVisualAssetUrl({
              plugin: input.plugin,
              variant,
              baseUrl: input.baseUrl,
            }),
          },
        }),
  };
}

export function safeDiscordMentions(
  input: {
    roles?: string[];
    users?: string[];
  } = {},
): DiscordVisualMessagePayload['allowedMentions'] {
  return {
    parse: [],
    ...(input.roles?.length ? { roles: uniqueSnowflakes(input.roles) } : {}),
    ...(input.users?.length ? { users: uniqueSnowflakes(input.users) } : {}),
  };
}

export function truncateDiscordText(value: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 1, 0))}…`;
}

function normalizeTimestamp(value: Date | string | number | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeAssetSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-');
  return normalized.replace(/^-+|-+$/gu, '') || 'generic';
}

function humanizePluginName(plugin: string): string {
  return plugin
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function uniqueSnowflakes(values: string[]): string[] {
  return [...new Set(values.filter((value) => /^\d{17,20}$/u.test(value)))];
}
