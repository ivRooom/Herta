import { MessageFlags } from 'discord.js';
import type { SlashCommand } from './registry.js';

export const pingCommand: SlashCommand = {
  definition: {
    name: 'ping',
    description: 'Pong! と応答して疎通を確認します',
  },
  async execute(interaction) {
    await interaction.reply({
      content: `🏓 Pong! (WebSocket: ${interaction.client.ws.ping}ms)`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
