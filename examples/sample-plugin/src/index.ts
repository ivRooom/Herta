import type { PrismaClient } from '@herta/db';
import { definePlugin } from '@herta/plugin-sdk';
import type { Client, ChatInputCommandInteraction, Message } from 'discord.js';
import type { PluginManifest } from '@herta/shared';

interface SampleConfig {
  greeting?: string;
}

const manifest: PluginManifest = {
  id: 'sample-plugin',
  name: 'Sample Plugin',
  version: '0.1.0',
  description: 'Plugin SDK の利用例',
  author: { name: 'Herta' },
  category: 'utility',
  permissions: [],
  dependencies: [],
  configSchema: {
    type: 'object',
    properties: { greeting: { type: 'string' } },
    additionalProperties: false,
  },
  events: ['messageCreate'],
  commands: [{ name: 'sample-ping', description: 'Sample Plugin の応答を確認します' }],
};

export const samplePlugin = definePlugin<SampleConfig, Client, PrismaClient>({
  manifest,
  async onEnable(context) {
    context.logger.info({ guildId: context.guildId }, 'Sample Plugin を有効化しました');
  },
  async onDisable(context) {
    context.logger.info({ guildId: context.guildId }, 'Sample Plugin を無効化しました');
  },
  provideCommands(context) {
    return [
      {
        definition: manifest.commands[0]!,
        async execute(interaction: ChatInputCommandInteraction) {
          await interaction.reply(context.config.greeting ?? 'pong');
        },
      },
    ];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(eventContext, ...args: unknown[]) {
          const message = args[0] as Message;
          if (message.guildId === eventContext.guildId && !message.author.bot) {
            eventContext.logger.debug({ messageId: message.id }, 'メッセージを受信しました');
          }
        },
      },
    ];
  },
});

export default samplePlugin;
