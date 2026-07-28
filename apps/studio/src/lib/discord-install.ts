const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

const VIEW_CHANNEL_PERMISSION = 1024n;
const SEND_MESSAGES_PERMISSION = 2048n;
const EMBED_LINKS_PERMISSION = 16384n;
const SEND_MESSAGES_IN_THREADS_PERMISSION = 274877906944n;

/**
 * 公式Pluginの参照・通常投稿・Embed・Thread応答に必要な最小権限を要求する。
 * 追加権限が必要な環境ではDISCORD_BOT_PERMISSIONSで明示的に上書きできる。
 */
export const DEFAULT_DISCORD_BOT_PERMISSIONS = (
  VIEW_CHANNEL_PERMISSION |
  SEND_MESSAGES_PERMISSION |
  EMBED_LINKS_PERMISSION |
  SEND_MESSAGES_IN_THREADS_PERMISSION
).toString();

interface DiscordGuildInstallUrlOptions {
  clientId: string;
  guildId?: string;
  permissions?: string;
}

function assertNumericParameter(name: string, value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must contain only digits`);
  }
}

/** DiscordのGuild Install用OAuth2 URLを生成する。 */
export function buildDiscordGuildInstallUrl({
  clientId,
  guildId,
  permissions = DEFAULT_DISCORD_BOT_PERMISSIONS,
}: DiscordGuildInstallUrlOptions): string {
  assertNumericParameter('clientId', clientId);
  assertNumericParameter('permissions', permissions);
  if (guildId) assertNumericParameter('guildId', guildId);

  const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('integration_type', '0');
  url.searchParams.set('permissions', permissions);

  if (guildId) {
    url.searchParams.set('guild_id', guildId);
    url.searchParams.set('disable_guild_select', 'true');
  }

  return url.toString();
}

/** Studioの環境変数からGuild Install URLを生成する。 */
export function getDiscordGuildInstallUrl(guildId?: string): string | null {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return null;

  const permissions =
    process.env.DISCORD_BOT_PERMISSIONS?.trim() || DEFAULT_DISCORD_BOT_PERMISSIONS;

  return buildDiscordGuildInstallUrl({ clientId, guildId, permissions });
}
