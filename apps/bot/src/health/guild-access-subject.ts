import type { Client } from 'discord.js';

export interface GuildAccessSubject {
  guildId: string;
  userId: string;
  roleIds: string[];
  isGuildOwner: boolean;
}

export async function getGuildAccessSubject(
  client: Client,
  guildId: string,
  userId: string,
): Promise<GuildAccessSubject | null> {
  if (!/^\d{17,20}$/u.test(guildId) || !/^\d{17,20}$/u.test(userId)) return null;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  try {
    const member = await guild.members.fetch(userId);
    return {
      guildId,
      userId,
      roleIds: [...member.roles.cache.keys()].filter((roleId) => roleId !== guildId).sort(),
      isGuildOwner: guild.ownerId === userId,
    };
  } catch {
    return null;
  }
}
