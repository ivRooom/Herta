import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';

export interface GuildChannelOption {
  id: string;
  name: string;
  kind: 'text' | 'announcement';
  position: number;
  parentId: string | null;
}

export interface GuildRoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  editable: boolean;
}

export interface GuildBotPermissionSnapshot {
  manageMessages: boolean;
  manageRoles: boolean;
  moderateMembers: boolean;
  kickMembers: boolean;
  banMembers: boolean;
  mentionEveryone: boolean;
  highestRolePosition: number;
}

export interface GuildConfigurationOptions {
  guildId: string;
  guildName: string;
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  bot: GuildBotPermissionSnapshot;
  fetchedAt: string;
}

export async function loadGuildConfigurationOptions(
  client: Client,
  guildId: string,
): Promise<GuildConfigurationOptions | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const [channels, roles, me] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
    guild.members.me ? Promise.resolve(guild.members.me) : guild.members.fetchMe(),
  ]);

  const channelOptions = [...channels.values()]
    .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
    .filter(
      (channel) =>
        channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement,
    )
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      kind: channel.type === ChannelType.GuildAnnouncement ? ('announcement' as const) : ('text' as const),
      position: channel.rawPosition,
      parentId: channel.parentId,
    }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ja'));

  const roleOptions = [...roles.values()]
    .filter((role) => role.id !== guild.id)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      mentionable: role.mentionable,
      editable: role.editable,
    }))
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name, 'ja'));

  return {
    guildId: guild.id,
    guildName: guild.name,
    channels: channelOptions,
    roles: roleOptions,
    bot: {
      manageMessages: me.permissions.has(PermissionFlagsBits.ManageMessages),
      manageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
      moderateMembers: me.permissions.has(PermissionFlagsBits.ModerateMembers),
      kickMembers: me.permissions.has(PermissionFlagsBits.KickMembers),
      banMembers: me.permissions.has(PermissionFlagsBits.BanMembers),
      mentionEveryone: me.permissions.has(PermissionFlagsBits.MentionEveryone),
      highestRolePosition: me.roles.highest.position,
    },
    fetchedAt: new Date().toISOString(),
  };
}
