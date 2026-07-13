import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getPrismaClient } from '@herta/db';
import { getEnabledPlugins } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import { pingCommand } from './commands/ping.js';
import { CommandRegistry } from './commands/registry.js';
import { defaultGuildPluginCache } from './plugins/cache.js';
import { GuildPluginLoader } from './plugins/loader.js';
import { defaultPluginRegistry } from './plugins/registry.js';
import { syncGuildCommands } from './plugins/sync.js';
import type { SlashCommand } from './commands/registry.js';

/** Herta Bot クライアント */
export class HertaBot {
  private client: Client;
  private registry: CommandRegistry;
  private readonly pluginCache = defaultGuildPluginCache;
  private readonly pluginLoader: GuildPluginLoader;
  private readonly pluginCommands = new Map<string, SlashCommand[]>();

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
    this.pluginLoader = new GuildPluginLoader({
      registry: defaultPluginRegistry,
      cache: this.pluginCache,
      logger: this.logger,
      coreCommandNames: this.registry.getAll().map((command) => command.definition.name),
      fetchEnabledPlugins: async (guildId) => {
        if (!process.env['DATABASE_URL']) {
          this.logger.warn({ guildId }, 'DATABASE_URLが未設定のためPlugin取得をスキップします');
          return [];
        }
        return getEnabledPlugins(getPrismaClient(), guildId);
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, async (client) => {
      this.logger.info(
        { username: client.user.tag, guilds: client.guilds.cache.size },
        'Herta Bot がログインしました',
      );
      const guildId = process.env['DISCORD_GUILD_ID_DEV'];
      if (!guildId) {
        this.logger.warn(
          'DISCORD_GUILD_ID_DEVが設定されていないため、Guild Commandの登録をスキップします',
        );
        return;
      }
      await this.syncGuild(client, guildId);
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command =
        this.registry.get(interaction.commandName) ??
        this.pluginCommands
          .get(interaction.guildId ?? '')
          ?.find((candidate) => candidate.definition.name === interaction.commandName);
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

  private async syncGuild(client: Client, guildId: string): Promise<void> {
    const pluginCommands = await this.pluginLoader.getGuildCommands(guildId);
    this.pluginCommands.set(guildId, pluginCommands);
    await syncGuildCommands(client, guildId, this.registry.getAll(), pluginCommands, this.logger);
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

  /** Plugin設定変更時にGuildのCommand一覧を再構築する（イベント配線は将来追加する）。 */
  async resyncGuild(guildId: string): Promise<void> {
    this.pluginCache.invalidate(guildId);
    await this.syncGuild(this.client, guildId);
  }
}
