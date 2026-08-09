import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';

export interface GuildChannelOption {
  id: string;
  name: string;
  kind: 'text' | 'announcement' | 'forum' | 'thread';
  position: number;
  parentId: string | null;
  viewable: boolean;
  readMessageHistory: boolean;
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

export interface GuildEmojiOption {
  id: string;
  name: string;
  animated: boolean;
  available: boolean;
  managed: boolean;
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
  emojis: GuildEmojiOption[];
  bot: GuildBotPermissionSnapshot;
  fetchedAt: string;
}

export async function loadGuildConfigurationOptions(
  client: Client,
  guildId: string,
): Promise<GuildConfigurationOptions | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const [channels, activeThreads, roles, emojis, me] = await Promise.all([
    guild.channels.fetch(),
    guild.channels.fetchActiveThreads().catch(() => null),
    guild.roles.fetch(),
    guild.emojis.fetch(),
    guild.members.me ? Promise.resolve(guild.members.me) : guild.members.fetchMe(),
  ]);

  const channelOptions: GuildChannelOption[] = [...channels.values()]
    .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
    .filter(
      (channel) =>
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildForum,
    )
    .map((channel) => {
      const permissions = channel.permissionsFor(me);
      const kind: GuildChannelOption['kind'] =
        channel.type === ChannelType.GuildAnnouncement
          ? 'announcement'
          : channel.type === ChannelType.GuildForum
            ? 'forum'
            : 'text';
      return {
        id: channel.id,
        name: channel.name,
        kind,
        position: channel.rawPosition,
        parentId: channel.parentId,
        viewable: permissions?.has(PermissionFlagsBits.ViewChannel) ?? false,
        readMessageHistory: permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false,
      };
    });

  if (activeThreads) {
    for (const thread of activeThreads.threads.values()) {
      const permissions = thread.permissionsFor(me);
      channelOptions.push({
        id: thread.id,
        name: thread.name,
        kind: 'thread',
        position: thread.parent?.rawPosition ?? 0,
        parentId: thread.parentId,
        viewable: permissions?.has(PermissionFlagsBits.ViewChannel) ?? false,
        readMessageHistory: permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false,
      });
    }
  }

  channelOptions.sort(
    (a, b) =>
      a.position - b.position ||
      (a.kind === 'thread' ? 1 : 0) - (b.kind === 'thread' ? 1 : 0) ||
      a.name.localeCompare(b.name, 'ja'),
  );

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

  const emojiOptions = [...emojis.values()]
    .map((emoji) => ({
      id: emoji.id,
      name: emoji.name ?? emoji.id,
      animated: Boolean(emoji.animated),
      available: emoji.available !== false,
      managed: emoji.managed,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return {
    guildId: guild.id,
    guildName: guild.name,
    channels: channelOptions,
    roles: roleOptions,
    emojis: emojiOptions,
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
