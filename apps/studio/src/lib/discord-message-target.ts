export type DiscordMessageTarget = {
  channelId: string;
  messageId: string;
};

const SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
const MESSAGE_URL_PATTERN =
  /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:[/?#].*)?$/u;

export function normalizeDiscordMessageTarget(value: unknown): DiscordMessageTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { channelId: '', messageId: '' };
  }

  const source = value as Record<string, unknown>;
  return {
    channelId: typeof source.channelId === 'string' ? source.channelId : '',
    messageId: typeof source.messageId === 'string' ? source.messageId : '',
  };
}

export function mergeDiscordMessageTarget(
  current: unknown,
  next: DiscordMessageTarget | null,
): Record<string, unknown> | null {
  if (next === null) return null;
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  return { ...(base as Record<string, unknown>), ...next };
}

export function parseDiscordMessageReference(
  input: string,
  guildId: string,
  currentChannelId = '',
): DiscordMessageTarget | null {
  const normalized = input.trim();
  if (SNOWFLAKE_PATTERN.test(normalized)) {
    if (!SNOWFLAKE_PATTERN.test(currentChannelId)) return null;
    return { channelId: currentChannelId, messageId: normalized };
  }

  const match = normalized.match(MESSAGE_URL_PATTERN);
  if (!match) return null;
  const [, referencedGuildId, channelId, messageId] = match;
  if (referencedGuildId !== guildId || !channelId || !messageId) return null;
  return { channelId, messageId };
}

export function buildDiscordMessageUrl(
  guildId: string,
  value: DiscordMessageTarget,
): string | null {
  if (
    !SNOWFLAKE_PATTERN.test(guildId) ||
    !SNOWFLAKE_PATTERN.test(value.channelId) ||
    !SNOWFLAKE_PATTERN.test(value.messageId)
  ) {
    return null;
  }
  return `https://discord.com/channels/${guildId}/${value.channelId}/${value.messageId}`;
}
