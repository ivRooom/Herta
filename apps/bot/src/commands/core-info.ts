import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
} from 'discord.js';
import { coreFunUtilityCommands } from './fun-utility.js';
import type { SlashCommand } from './registry.js';

const CORE_COMMANDS = [
  ['/ping', 'Botとの疎通とWebSocketレイテンシを確認'],
  ['/help', 'HertaのCore Command一覧を表示'],
  ['/server', '現在のDiscordサーバー情報を表示'],
  ['/userinfo [user]', 'Discordユーザー情報を表示'],
  ['/avatar [user]', 'ユーザーのアバターを高解像度で表示'],
  ['/botinfo', 'Herta Botの稼働情報を表示'],
  ['/roleinfo role', 'Discord Roleの情報を表示'],
  ['/channelinfo channel', 'Discord Channelの情報を表示'],
  ['/permissions [user]', 'サーバー内での主要権限を確認'],
  ['/choose choices', '候補の中からランダムに1つ選択'],
  ['/dice [sides] [count]', '指定したダイスを振る'],
  ['/coinflip', 'コインを投げて表か裏を決定'],
  ['/random min max', '指定範囲からランダムな整数を生成'],
] as const;

const PERMISSION_LABELS: Array<[bigint, string]> = [
  [PermissionFlagsBits.Administrator, '管理者'],
  [PermissionFlagsBits.ManageGuild, 'サーバー管理'],
  [PermissionFlagsBits.ManageChannels, 'チャンネル管理'],
  [PermissionFlagsBits.ManageRoles, 'ロール管理'],
  [PermissionFlagsBits.ManageMessages, 'メッセージ管理'],
  [PermissionFlagsBits.ModerateMembers, 'メンバーをタイムアウト'],
  [PermissionFlagsBits.KickMembers, 'メンバーをキック'],
  [PermissionFlagsBits.BanMembers, 'メンバーをBAN'],
  [PermissionFlagsBits.ViewAuditLog, '監査ログを表示'],
  [PermissionFlagsBits.ManageWebhooks, 'Webhook管理'],
  [PermissionFlagsBits.ManageEvents, 'イベント管理'],
  [PermissionFlagsBits.MentionEveryone, '@everyone等をメンション'],
];

function discordTimestamp(date: Date, style: 'F' | 'R' = 'F'): string {
  return `<t:${Math.floor(date.getTime() / 1_000)}:${style}>`;
}

function snowflakeCreatedAt(id: string): Date {
  return new Date(Number(BigInt(id) >> 22n) + 1_420_070_400_000);
}

function channelTypeLabel(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return 'テキスト';
    case ChannelType.GuildVoice:
      return 'ボイス';
    case ChannelType.GuildCategory:
      return 'カテゴリ';
    case ChannelType.GuildAnnouncement:
      return 'アナウンス';
    case ChannelType.AnnouncementThread:
      return 'アナウンススレッド';
    case ChannelType.PublicThread:
      return '公開スレッド';
    case ChannelType.PrivateThread:
      return '非公開スレッド';
    case ChannelType.GuildStageVoice:
      return 'ステージ';
    case ChannelType.GuildForum:
      return 'フォーラム';
    case ChannelType.GuildMedia:
      return 'メディア';
    default:
      return `Type ${type}`;
  }
}

function roleColor(color: number): number {
  return color || 0x5865f2;
}

function roleHexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

function memberPermissionSummary(member: GuildMember): string {
  const permissions = PERMISSION_LABELS.filter(([flag]) => member.permissions.has(flag)).map(
    ([, label]) => label,
  );
  return permissions.length > 0 ? permissions.join('\n') : '主要な管理権限はありません';
}

export const helpCommand: SlashCommand = {
  definition: {
    name: 'help',
    description: 'Hertaで利用できるCore Commandの一覧を表示します',
  },
  async execute(interaction) {
    const description = CORE_COMMANDS.map(([name, detail]) => `**${name}**\n${detail}`).join(
      '\n\n',
    );
    const embed = new EmbedBuilder()
      .setTitle('Herta Command Help')
      .setDescription(description)
      .setColor(0x7c6df2)
      .setFooter({ text: 'Plugin Commandは有効化されたPluginに応じて追加されます' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const serverCommand: SlashCommand = {
  definition: {
    name: 'server',
    description: '現在のDiscordサーバー情報を表示します',
  },
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setColor(0x5865f2)
      .addFields(
        { name: 'サーバーID', value: guild.id, inline: true },
        { name: 'メンバー数', value: guild.memberCount.toLocaleString('ja-JP'), inline: true },
        {
          name: 'チャンネル数',
          value: guild.channels.cache.size.toLocaleString('ja-JP'),
          inline: true,
        },
        { name: 'ロール数', value: guild.roles.cache.size.toLocaleString('ja-JP'), inline: true },
        { name: 'Boost', value: `${guild.premiumSubscriptionCount ?? 0}件`, inline: true },
        { name: '作成日時', value: discordTimestamp(guild.createdAt), inline: false },
      );

    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const userInfoCommand: SlashCommand = {
  definition: {
    name: 'userinfo',
    description: 'Discordユーザー情報を表示します',
    options: [
      {
        name: 'user',
        description: '情報を確認するユーザー。省略時は自分自身',
        type: 'user',
      },
    ],
  },
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild?.members.cache.get(user.id);
    const embed = new EmbedBuilder()
      .setTitle(user.globalName ?? user.username)
      .setColor(member?.displayColor || 0x5865f2)
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: 'ユーザーID', value: user.id, inline: true },
        { name: 'ユーザー名', value: user.username, inline: true },
        { name: 'Bot', value: user.bot ? 'はい' : 'いいえ', inline: true },
        { name: 'アカウント作成', value: discordTimestamp(user.createdAt), inline: false },
      );

    if (member) {
      embed.addFields(
        {
          name: 'サーバー参加',
          value: member.joinedAt ? discordTimestamp(member.joinedAt) : '取得できません',
          inline: false,
        },
        {
          name: 'ロール',
          value:
            member.roles.cache
              .filter((role) => role.id !== interaction.guildId)
              .map(String)
              .join(' ') || 'なし',
          inline: false,
        },
      );
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const avatarCommand: SlashCommand = {
  definition: {
    name: 'avatar',
    description: 'ユーザーのアバターを高解像度で表示します',
    options: [
      {
        name: 'user',
        description: 'アバターを確認するユーザー。省略時は自分自身',
        type: 'user',
      },
    ],
  },
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const avatarUrl = user.displayAvatarURL({ size: 4096 });
    const embed = new EmbedBuilder()
      .setTitle(`${user.globalName ?? user.username} のアバター`)
      .setURL(avatarUrl)
      .setImage(avatarUrl)
      .setColor(0x5865f2);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const botInfoCommand: SlashCommand = {
  definition: {
    name: 'botinfo',
    description: 'Herta Botの稼働情報を表示します',
  },
  async execute(interaction) {
    const clientUser = interaction.client.user;
    const uptimeSeconds = Math.floor(process.uptime());
    const days = Math.floor(uptimeSeconds / 86_400);
    const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
    const minutes = Math.floor((uptimeSeconds % 3_600) / 60);
    const version = process.env['HERTA_VERSION']?.trim() || '0.1.0';

    const embed = new EmbedBuilder()
      .setTitle('Herta Bot')
      .setColor(0x7c6df2)
      .setThumbnail(clientUser.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Version', value: version, inline: true },
        { name: 'WebSocket Ping', value: `${interaction.client.ws.ping}ms`, inline: true },
        {
          name: '参加サーバー',
          value: interaction.client.guilds.cache.size.toLocaleString('ja-JP'),
          inline: true,
        },
        { name: '稼働時間', value: `${days}日 ${hours}時間 ${minutes}分`, inline: false },
        { name: 'Node.js', value: process.version, inline: true },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const roleInfoCommand: SlashCommand = {
  definition: {
    name: 'roleinfo',
    description: 'Discord Roleの情報を表示します',
    options: [
      {
        name: 'role',
        description: '情報を確認するロール',
        type: 'role',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const role = interaction.options.getRole('role', true);
    const embed = new EmbedBuilder()
      .setTitle(role.name)
      .setColor(roleColor(role.color))
      .addFields(
        { name: 'ロールID', value: role.id, inline: true },
        { name: '表示位置', value: String(role.position), inline: true },
        { name: '色', value: roleHexColor(role.color), inline: true },
        { name: 'メンション可能', value: role.mentionable ? 'はい' : 'いいえ', inline: true },
        { name: '個別表示', value: role.hoist ? 'はい' : 'いいえ', inline: true },
        { name: '管理ロール', value: role.managed ? 'はい' : 'いいえ', inline: true },
        { name: '作成日時', value: discordTimestamp(snowflakeCreatedAt(role.id)), inline: false },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const channelInfoCommand: SlashCommand = {
  definition: {
    name: 'channelinfo',
    description: 'Discord Channelの情報を表示します',
    options: [
      {
        name: 'channel',
        description: '情報を確認するチャンネル',
        type: 'channel',
        required: true,
      },
    ],
  },
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel', true);
    const createdAt = snowflakeCreatedAt(channel.id);
    const title =
      'name' in channel && typeof channel.name === 'string' ? channel.name : 'Discord Channel';
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x5865f2)
      .addFields(
        { name: 'チャンネルID', value: channel.id, inline: true },
        { name: '種類', value: channelTypeLabel(channel.type), inline: true },
        { name: '作成日時', value: discordTimestamp(createdAt), inline: false },
      );

    if ('parent' in channel && channel.parent) {
      embed.addFields({ name: 'カテゴリ', value: channel.parent.name, inline: false });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const permissionsCommand: SlashCommand = {
  definition: {
    name: 'permissions',
    description: 'サーバー内での主要な管理権限を確認します',
    options: [
      {
        name: 'user',
        description: '権限を確認するユーザー。省略時は自分自身',
        type: 'user',
      },
    ],
  },
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'このコマンドはDiscordサーバー内でのみ利用できます。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = guild.members.cache.get(user.id);
    if (!member) {
      await interaction.reply({
        content:
          '対象ユーザーのサーバー権限を現在のキャッシュから取得できません。Guild Members Intentを有効化していない環境では、未キャッシュのメンバーは取得できない場合があります。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${member.displayName} の主要権限`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setColor(member.displayColor || 0x5865f2)
      .setDescription(memberPermissionSummary(member))
      .setFooter({ text: `User ID: ${user.id}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const coreInformationCommands: SlashCommand[] = [
  helpCommand,
  serverCommand,
  userInfoCommand,
  avatarCommand,
  botInfoCommand,
  roleInfoCommand,
  channelInfoCommand,
  permissionsCommand,
  ...coreFunUtilityCommands,
];
