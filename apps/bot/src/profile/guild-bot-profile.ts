import { Routes, type Client } from 'discord.js';

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

export interface GuildBotProfile {
  userId: string;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  guildAvatar: boolean;
}

export interface GuildBotProfileUpdate {
  nickname: string | null;
  avatar?: string | null;
}

const MAX_BOT_AVATAR_BYTES = 1024 * 1024;
const AVATAR_DATA_URI_PREFIXES = [
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/gif;base64,',
] as const;
const MAX_INTERNAL_AVATAR_DATA_URI_LENGTH =
  Math.ceil(MAX_BOT_AVATAR_BYTES / 3) * 4 + 'data:image/jpeg;base64,'.length;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A_SIGNATURE = Buffer.from('GIF87a', 'ascii');
const GIF89A_SIGNATURE = Buffer.from('GIF89a', 'ascii');

export async function getGuildBotProfile(
  client: Client,
  guildId: string,
): Promise<GuildBotProfile | null> {
  if (!client.guilds.cache.has(guildId)) return null;

  const member = parseDiscordBotGuildMember(
    await client.rest.get(Routes.guildMember(guildId, '@me')),
  );
  return member ? toGuildBotProfile(guildId, member) : null;
}

export async function updateGuildBotProfile(
  client: Client,
  guildId: string,
  input: GuildBotProfileUpdate,
): Promise<GuildBotProfile | null> {
  if (!client.guilds.cache.has(guildId)) return null;

  const body: { nick: string | null; avatar?: string | null } = { nick: input.nickname };
  if (input.avatar !== undefined) body.avatar = input.avatar;

  const member = parseDiscordBotGuildMember(
    await client.rest.patch(Routes.guildMember(guildId, '@me'), { body }),
  );
  return member ? toGuildBotProfile(guildId, member) : null;
}

export function parseGuildBotProfileUpdate(value: unknown): GuildBotProfileUpdate | null {
  if (!isRecord(value)) return null;

  const nickname = value.nickname;
  if (nickname !== null && (typeof nickname !== 'string' || nickname.length > 32)) return null;

  if (!Object.hasOwn(value, 'avatar')) return { nickname };

  const avatar = value.avatar;
  if (avatar === null) return { nickname, avatar: null };
  if (typeof avatar !== 'string' || avatar.length > MAX_INTERNAL_AVATAR_DATA_URI_LENGTH) {
    return null;
  }

  const prefix = AVATAR_DATA_URI_PREFIXES.find((candidate) => avatar.startsWith(candidate));
  if (!prefix) return null;

  const encoded = avatar.slice(prefix.length);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    return null;
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BOT_AVATAR_BYTES) return null;
  if (!matchesAvatarSignature(prefix, bytes)) return null;

  return { nickname, avatar };
}

function matchesAvatarSignature(
  prefix: (typeof AVATAR_DATA_URI_PREFIXES)[number],
  bytes: Buffer,
): boolean {
  if (prefix === 'data:image/png;base64,') return startsWithSignature(bytes, PNG_SIGNATURE);
  if (prefix === 'data:image/jpeg;base64,') return startsWithSignature(bytes, JPEG_SIGNATURE);
  return (
    startsWithSignature(bytes, GIF87A_SIGNATURE) || startsWithSignature(bytes, GIF89A_SIGNATURE)
  );
}

function startsWithSignature(bytes: Buffer, signature: Buffer): boolean {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function parseDiscordBotGuildMember(value: unknown): DiscordBotGuildMember | null {
  if (!isRecord(value) || !isRecord(value.user)) return null;

  const userId = value.user.id;
  const username = value.user.username;
  const userAvatar = value.user.avatar;
  const nickname = value.nick;
  const memberAvatar = value.avatar;

  if (typeof userId !== 'string' || typeof username !== 'string') return null;
  if (userAvatar !== null && typeof userAvatar !== 'string') return null;
  if (nickname !== null && typeof nickname !== 'string') return null;
  if (memberAvatar !== null && typeof memberAvatar !== 'string') return null;

  return {
    nick: nickname,
    avatar: memberAvatar,
    user: { id: userId, username, avatar: userAvatar },
  };
}

function toGuildBotProfile(guildId: string, member: DiscordBotGuildMember): GuildBotProfile {
  const guildAvatar = Boolean(member.avatar);
  const avatarHash = member.avatar ?? member.user.avatar;
  const avatarUrl = avatarHash
    ? member.avatar
      ? `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'webp'}?size=256`
      : `https://cdn.discordapp.com/avatars/${member.user.id}/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'webp'}?size=256`
    : null;

  return {
    userId: member.user.id,
    username: member.user.username,
    nickname: member.nick,
    avatarUrl,
    guildAvatar,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
