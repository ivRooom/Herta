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
  /** 従来のMessage endpointへ直接投稿できる安全なチャンネル候補。 */
  channels: GuildChannelOption[];
  /** Forum/Thread対応済みのconsumerが明示的に利用する配信先候補。 */
  messageTargets: GuildChannelOption[];
  roles: GuildRoleOption[];
  emojis: GuildEmojiOption[];
  bot: GuildBotPermissionSnapshot;
  fetchedAt: string;
}

const DISCORD_CHANNEL_FLAG_REQUIRE_TAG = 1 << 4;

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

  const messageTargets: GuildChannelOption[] = [...channels.values()]
    .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
    .filter(
      (channel) =>
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildForum,
    )
    .filter(
      (channel) =>
        channel.type !== ChannelType.GuildForum ||
        !channel.flags.has(DISCORD_CHANNEL_FLAG_REQUIRE_TAG),
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
      if (thread.archived) continue;
      const permissions = thread.permissionsFor(me);
      messageTargets.push({
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

  messageTargets.sort(
    (a, b) =>
      a.position - b.position ||
      (a.kind === 'thread' ? 1 : 0) - (b.kind === 'thread' ? 1 : 0) ||
      a.name.localeCompare(b.name, 'ja'),
  );

  // Forum/Thread未対応の既存consumerには従来どおり直接投稿可能な候補だけを返す。
  const channelOptions = messageTargets.filter(
    (channel) => channel.kind === 'text' || channel.kind === 'announcement',
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
    messageTargets,
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
