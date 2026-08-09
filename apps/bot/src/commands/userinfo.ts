import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

export const userInfoCommand: SlashCommand = {
  definition: {
    name: 'userinfo',
    description: 'Discordユーザーの基本情報を表示します',
    options: [
      {
        name: 'user',
        description: '確認するユーザー。省略すると自分を表示します',
        type: 'user',
        required: false,
      },
    ],
  },
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const createdAt = new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tokyo',
    }).format(user.createdAt);

    await interaction.reply({
      content: [
        `**${user.globalName ?? user.username}**`,
        `Username: ${user.username}`,
        `User ID: ${user.id}`,
        `Bot: ${user.bot ? 'はい' : 'いいえ'}`,
        `アカウント作成: ${createdAt}`,
        `Avatar: ${user.displayAvatarURL({ size: 1024 })}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
