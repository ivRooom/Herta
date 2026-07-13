/**
 * Discord API との通信ヘルパー。
 * OAuth アクセストークンを用いてユーザーの Guild 一覧を取得し、
 * 管理権限を持つ Guild のみを抽出する。
 */

export const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord のパーミッションビット */
export const DiscordPermission = {
  /** ADMINISTRATOR (1 << 3) */
  ADMINISTRATOR: 1n << 3n,
  /** MANAGE_GUILD (1 << 5) */
  MANAGE_GUILD: 1n << 5n,
} as const;

/** Discord API が返す Guild オブジェクト (partial) */
export interface DiscordPartialGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
}

/** 管理画面で扱う Guild 表現 */
export interface ManageableGuild {
  id: string;
  name: string;
  icon: string | null;
  /** アイコン画像 URL (無い場合は null) */
  iconUrl: string | null;
  owner: boolean;
  /** 管理者権限を持つか */
  hasAdministrator: boolean;
  /** サーバー管理権限を持つか */
  hasManageGuild: boolean;
}

/** Discord のアイコンハッシュから画像 URL を組み立てる */
export function guildIconUrl(guildId: string, icon: string | null): string | null {
  if (!icon) return null;
  const ext = icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=128`;
}

/** ユーザーが Guild に対して管理権限 (Administrator もしくは Manage Guild) を持つか */
export function canManageGuild(guild: DiscordPartialGuild): boolean {
  if (guild.owner) return true;
  const permissions = BigInt(guild.permissions);
  const hasAdmin =
    (permissions & DiscordPermission.ADMINISTRATOR) === DiscordPermission.ADMINISTRATOR;
  const hasManage =
    (permissions & DiscordPermission.MANAGE_GUILD) === DiscordPermission.MANAGE_GUILD;
  return hasAdmin || hasManage;
}

/** アクセストークンでログインユーザーの Guild 一覧を取得する */
export async function fetchUserGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Guild権限は認可判断に使うため、権限剥奪を即時反映できるよう共有cacheへ保存しない。
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Discord Guild 一覧の取得に失敗しました (status: ${res.status})`);
  }

  return (await res.json()) as DiscordPartialGuild[];
}

/** 管理権限を持つ Guild だけを抽出して整形する */
export async function fetchManageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
  const guilds = await fetchUserGuilds(accessToken);
  return guilds
    .filter(canManageGuild)
    .map((guild) => {
      const permissions = BigInt(guild.permissions);
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        iconUrl: guildIconUrl(guild.id, guild.icon),
        owner: guild.owner,
        hasAdministrator:
          guild.owner ||
          (permissions & DiscordPermission.ADMINISTRATOR) === DiscordPermission.ADMINISTRATOR,
        hasManageGuild:
          (permissions & DiscordPermission.MANAGE_GUILD) === DiscordPermission.MANAGE_GUILD,
      } satisfies ManageableGuild;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
