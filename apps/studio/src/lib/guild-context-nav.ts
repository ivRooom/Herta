const DISCORD_GUILD_ID = /^\d{17,20}$/u;
const GUILD_DASHBOARD_PATH = /^\/dashboard\/guilds\/(\d{17,20})(?:\/|$)/u;

export type GuildConsoleSection =
  | 'overview'
  | 'plugins'
  | 'leaderboard'
  | 'moderation'
  | 'audit-logs'
  | 'bot-profile'
  | 'other';

export interface GuildConsoleContext {
  guildId: string;
  section: GuildConsoleSection;
}

export function isDiscordGuildId(value: string): boolean {
  return DISCORD_GUILD_ID.test(value);
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
  if (isRouteOrChild(pathname, `${basePath}/leaderboard`)) {
    return { guildId, section: 'leaderboard' };
  }
  if (isRouteOrChild(pathname, `${basePath}/moderation`)) {
    return { guildId, section: 'moderation' };
  }
  if (isRouteOrChild(pathname, `${basePath}/audit-logs`)) {
    return { guildId, section: 'audit-logs' };
  }
  if (isRouteOrChild(pathname, `${basePath}/bot-profile`)) {
    return { guildId, section: 'bot-profile' };
  }
  return { guildId, section: 'other' };
}

export function getGuildConsoleHref(
  guildId: string,
  section: Exclude<GuildConsoleSection, 'other'>,
): string {
  const basePath = `/dashboard/guilds/${guildId}`;
  if (section === 'overview') return basePath;
  return `${basePath}/${section}`;
}

/**
 * 別Guildへ切り替える際の安全な遷移先を返す。
 * 主要管理画面は新Guildでも同じセクションを維持し、PluginやModerationの
 * 深いルートは各セクションのトップへ畳む。
 * BirthdayやDiagnosticsなど `other` の深いルートは新Guildでの存在・状態を
 * 保証できないため、新Guildの概要へ戻す。
 */
export function getGuildSwitchHref(
  targetGuildId: string,
  context: GuildConsoleContext | null,
): string {
  if (context && context.section !== 'other') {
    return getGuildConsoleHref(targetGuildId, context.section);
  }
  return getGuildConsoleHref(targetGuildId, 'overview');
}

function isRouteOrChild(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
