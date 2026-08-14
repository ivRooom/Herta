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
  if (pathname.startsWith(`${basePath}/plugins`)) {
    return { guildId, section: 'plugins' };
  }
  if (pathname.startsWith(`${basePath}/audit-logs`)) {
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
