const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

/**
 * 既定ではSend Messagesだけを要求する。
 * Pluginごとに追加権限が必要な場合は環境変数で明示的に拡張する。
 */
export const DEFAULT_DISCORD_BOT_PERMISSIONS = '2048';

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
