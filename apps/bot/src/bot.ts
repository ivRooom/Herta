import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Logger } from 'pino';
import { deployGuildCommands } from './commands/deploy.js';
import { pingCommand } from './commands/ping.js';
import { CommandRegistry } from './commands/registry.js';

/** Herta Bot クライアント */
export class HertaBot {
  private client: Client;
  private registry: CommandRegistry;

  constructor(private logger: Logger) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.registry = new CommandRegistry(this.logger);
    this.registry.register(pingCommand);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, async (client) => {
      this.logger.info(
        { username: client.user.tag, guilds: client.guilds.cache.size },
        'Herta Bot がログインしました',
      );
      await deployGuildCommands(client, this.registry, this.logger);
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command = this.registry.get(interaction.commandName);
      if (!command) {
        this.logger.warn(
          {
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
          },
          '不明な Slash Command が実行されました',
        );
        await this.replyEphemeral(interaction, '不明なコマンドです');
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        this.logger.error(
          {
            err: error,
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
          },
          'Slash Command の実行に失敗しました',
        );
        await this.replyEphemeral(interaction, 'コマンドの実行中にエラーが発生しました');
      }
    });
  }

  private async replyEphemeral(
    interaction: ChatInputCommandInteraction,
    content: string,
  ): Promise<void> {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  /** Bot を起動する */
  async start(): Promise<void> {
    const token = process.env['DISCORD_BOT_TOKEN'];
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN が設定されていません');
    }
    await this.client.login(token);
  }

  /** Bot を停止する */
  async stop(): Promise<void> {
    this.client.destroy();
    this.logger.info('Bot を停止しました');
  }
}
