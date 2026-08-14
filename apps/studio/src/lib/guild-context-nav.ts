const GUILD_DASHBOARD_PATH = /^\/dashboard\/guilds\/(\d{17,20})(?:\/|$)/u;

export type GuildConsoleSection = 'overview' | 'plugins' | 'audit-logs' | 'other';

export interface GuildConsoleContext {
  guildId: string;
  section: GuildConsoleSection;
}

export function getGuildConsoleContext(pathname: string): GuildConsoleContext | null {
  const match = GUILD_DASHBOARD_PATH.exec(pathname);
  const guildId = match?.[1];
  if (!guildId) return null;

  const basePath = `/dashboard/guilds/${guildId}`;
  if (pathname === basePath || pathname === `${basePath}/`) {
    return { guildId, section: 'overview' };
  }
  if (isRouteOrChild(pathname, `${basePath}/plugins`)) {
    return { guildId, section: 'plugins' };
  }
  if (isRouteOrChild(pathname, `${basePath}/audit-logs`)) {
    return { guildId, section: 'audit-logs' };
  }
  return { guildId, section: 'other' };
}

export function getGuildConsoleHref(
  guildId: string,
  section: Exclude<GuildConsoleSection, 'other'>,
): string {
  const basePath = `/dashboard/guilds/${guildId}`;
  if (section === 'overview') return basePath;
  if (section === 'plugins') return `${basePath}/plugins`;
  return `${basePath}/audit-logs`;
}

/**
 * 別Guildへ切り替える際の安全な遷移先を返す。
 * 主要管理画面だけは同じセクションを維持し、Plugin詳細や専用管理画面など
 * Guild固有の深いルートは存在保証ができないため新Guildの概要へ戻す。
 */
export function getGuildSwitchHref(
  targetGuildId: string,
  context: GuildConsoleContext | null,
): string {
  if (context?.section === 'plugins') return getGuildConsoleHref(targetGuildId, 'plugins');
  if (context?.section === 'audit-logs') return getGuildConsoleHref(targetGuildId, 'audit-logs');
  return getGuildConsoleHref(targetGuildId, 'overview');
}

function isRouteOrChild(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
