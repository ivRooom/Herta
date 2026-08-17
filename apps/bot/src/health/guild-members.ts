import type { Client, Guild, GuildMember } from 'discord.js';

export interface GuildMemberOption {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bot: boolean;
  roleIds: string[];
}

interface CacheEntry {
  expiresAt: number;
  members: GuildMemberOption[];
}

const MEMBER_SEARCH_CACHE_TTL_MS = 15_000;
const MEMBER_SEARCH_CACHE_MAX_ENTRIES = 200;
const memberSearchCache = new Map<string, CacheEntry>();

export async function searchGuildMemberOptions(
  client: Client,
  guildId: string,
  query: string,
  requestedLimit = 20,
): Promise<GuildMemberOption[] | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const normalizedQuery = query.trim().slice(0, 64);
  if (!isAllowedMemberSearchQuery(normalizedQuery)) return [];
  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit) || 20));
  const cacheKey = `${guildId}:${normalizedQuery.toLocaleLowerCase('ja')}:${limit}`;
  const now = Date.now();
  const cached = memberSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.members.map(cloneMemberOption);
  if (cached) memberSearchCache.delete(cacheKey);

  let members: GuildMemberOption[];
  if (/^\d{17,20}$/u.test(normalizedQuery)) {
    members = await searchExactMemberId(guild, normalizedQuery);
  } else {
    const result = await guild.members.search({ query: normalizedQuery, limit });
    members = [...result.values()].map(toMemberOption).slice(0, limit);
  }

  rememberSearch(cacheKey, members, now);
  return members.map(cloneMemberOption);
}

export function isAllowedMemberSearchQuery(query: string): boolean {
  const normalized = query.trim();
  return /^\d{17,20}$/u.test(normalized) || normalized.length >= 2;
}

function toMemberOption(member: GuildMember): GuildMemberOption {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    bot: member.user.bot,
    roleIds: [...member.roles.cache.keys()].filter((roleId) => roleId !== member.guild.id).sort(),
  };
}

function cloneMemberOption(member: GuildMemberOption): GuildMemberOption {
  return { ...member, roleIds: [...member.roleIds] };
}

async function searchExactMemberId(guild: Guild, memberId: string): Promise<GuildMemberOption[]> {
  try {
    const member = await guild.members.fetch(memberId);
    return [toMemberOption(member)];
  } catch {
    return [];
  }
}

function rememberSearch(key: string, members: GuildMemberOption[], now: number): void {
  if (memberSearchCache.size >= MEMBER_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = memberSearchCache.keys().next().value as string | undefined;
    if (oldestKey) memberSearchCache.delete(oldestKey);
  }
  memberSearchCache.set(cacheKeyForStore(key), {
    expiresAt: now + MEMBER_SEARCH_CACHE_TTL_MS,
    members: members.map(cloneMemberOption),
  });
}

function cacheKeyForStore(key: string): string {
  return key;
}
