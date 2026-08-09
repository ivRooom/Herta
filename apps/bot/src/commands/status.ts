import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

export const statusCommand: SlashCommand = {
  definition: {
    name: 'status',
    description: 'Herta Botの現在状態を確認します',
  },
  async execute(interaction) {
    const uptimeSeconds = Math.max(0, Math.floor(process.uptime()));
    const days = Math.floor(uptimeSeconds / 86_400);
    const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
    const minutes = Math.floor((uptimeSeconds % 3_600) / 60);
    const uptime = [days > 0 ? `${days}日` : '', hours > 0 ? `${hours}時間` : '', `${minutes}分`]
      .filter(Boolean)
      .join(' ');

    await interaction.reply({
      content: [
        '**Herta Status**',
        `Gateway: ${interaction.client.ws.status === 0 ? 'Ready' : `State ${interaction.client.ws.status}`}`,
        `WebSocket: ${interaction.client.ws.ping}ms`,
        `Uptime: ${uptime}`,
        `Guilds: ${interaction.client.guilds.cache.size}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
