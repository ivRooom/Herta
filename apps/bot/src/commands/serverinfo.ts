import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

export const serverInfoCommand: SlashCommand = {
  definition: {
    name: 'serverinfo',
    description: 'このDiscordサーバーの基本情報を表示します',
  },
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'このコマンドはサーバー内でのみ利用できます',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const createdAt = new Intl.DateTimeFormat('ja-JP', {
      dateStyle: 'medium',
      timeZone: 'Asia/Tokyo',
    }).format(guild.createdAt);

    await interaction.reply({
      content: [
        `**${guild.name}**`,
        `Guild ID: ${guild.id}`,
        `メンバー: ${guild.memberCount.toLocaleString('ja-JP')}人`,
        `チャンネル: ${guild.channels.cache.size}件`,
        `ロール: ${Math.max(0, guild.roles.cache.size - 1)}件`,
        `作成日: ${createdAt}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
