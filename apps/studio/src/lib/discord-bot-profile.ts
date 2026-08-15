import { DISCORD_API_BASE } from '@/lib/discord';

const DISCORD_BOT_REQUEST_TIMEOUT_MS = 5_000;

interface DiscordBotUser {
  id: string;
  username: string;
  avatar: string | null;
}

interface DiscordBotGuildMember {
  nick: string | null;
  avatar: string | null;
  user: DiscordBotUser;
}

export interface DiscordBotGuildProfile {
  userId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  guildAvatar: boolean;
}

export class DiscordBotProfileError extends Error {
  constructor(readonly status: number) {
    super(`Discord Bot profile request failed (${status})`);
    this.name = 'DiscordBotProfileError';
  }
}

export async function getDiscordBotGuildProfile(
  guildId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordBotGuildProfile> {
  const member = await requestDiscordBotMember(guildId, { method: 'GET' }, fetchImpl);
  return toBotGuildProfile(guildId, member);
}

export async function updateDiscordBotGuildProfile(
  guildId: string,
  input: { nickname: string | null; avatar?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordBotGuildProfile> {
  const body: { nick: string | null; avatar?: string | null } = { nick: input.nickname };
  if (input.avatar !== undefined) body.avatar = input.avatar;

  const member = await requestDiscordBotMember(
    guildId,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
  return toBotGuildProfile(guildId, member);
}

async function requestDiscordBotMember(
  guildId: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<DiscordBotGuildMember> {
  const token = process.env['DISCORD_BOT_TOKEN']?.trim();
  if (!token) throw new DiscordBotProfileError(503);

  let response: Response;
  try {
    response = await fetchImpl(`${DISCORD_API_BASE}/guilds/${guildId}/members/@me`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        ...init.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(DISCORD_BOT_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new DiscordBotProfileError(502);
  }

  if (!response.ok) throw new DiscordBotProfileError(response.status);

  try {
    const member = (await response.json()) as DiscordBotGuildMember;
    if (!member?.user?.id || !member.user.username) throw new Error('invalid member');
    return member;
  } catch {
    throw new DiscordBotProfileError(502);
  }
}

function toBotGuildProfile(guildId: string, member: DiscordBotGuildMember): DiscordBotGuildProfile {
  const guildAvatar = Boolean(member.avatar);
  const avatarHash = member.avatar ?? member.user.avatar;
  const avatarUrl = avatarHash
    ? member.avatar
      ? `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${avatarHash}.webp?size=256`
      : `https://cdn.discordapp.com/avatars/${member.user.id}/${avatarHash}.webp?size=256`
    : null;

  return {
    userId: member.user.id,
    username: member.user.username,
    nickname: member.nick,
    avatarUrl,
    guildAvatar,
  };
}
