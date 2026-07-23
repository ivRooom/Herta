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
import { createDefaultPluginRegistry } from './plugins/registry.js';
import { PluginRuntimeEventSubscriber } from './plugins/runtime-events.js';
import { syncGuildCommands } from './plugins/sync.js';
import type { SlashCommand } from './commands/registry.js';

/** Herta Bot クライアント */
export class HertaBot {
  private client: Client;
  private registry: CommandRegistry;
  private readonly prisma = getPrismaClient();
  private readonly pluginCache = defaultGuildPluginCache;
  private readonly pluginLoader: GuildPluginLoader;
  private readonly pluginCommands = new Map<string, SlashCommand[]>();
  private readonly runtimeEvents: PluginRuntimeEventSubscriber;

  constructor(private logger: Logger) {
    this.client = new Client({
      // 現在のRuntimeはSlash Commandのみを扱うため、Privileged Intentは要求しない。
      intents: [GatewayIntentBits.Guilds],
    });
    this.registry = new CommandRegistry(this.logger);
    this.registry.register(pingCommand);

    const pluginRegistry = createDefaultPluginRegistry({
      client: this.client,
      prisma: this.prisma,
      logger: this.logger,
    });
    this.pluginLoader = new GuildPluginLoader({
      registry: pluginRegistry,
      cache: this.pluginCache,
      logger: this.logger,
      coreCommandNames: this.registry.getAll().map((command) => command.definition.name),
      fetchEnabledPlugins: async (guildId) => {
        if (!process.env['DATABASE_URL']) {
          this.logger.warn({ guildId }, 'DATABASE_URLが未設定のためPlugin取得をスキップします');
          return [];
        }
        return getEnabledPlugins(this.prisma, guildId);
      },
    });
    this.runtimeEvents = new PluginRuntimeEventSubscriber(
      (guildId) => this.resyncGuild(guildId),
      this.logger,
    );
    pluginRegistry.validateAll(this.logger);
    pluginRegistry.validateAgainstCatalog(this.logger);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, async (client) => {
      this.logger.info(
        { username: client.user.tag, guilds: client.guilds.cache.size },
        'Herta Bot がログインしました',
      );

      const guildIds = this.resolveInitialSyncGuildIds(client);
      if (guildIds.length === 0) {
        this.logger.warn('同期対象のGuildがないため、Guild Commandの登録をスキップします');
        return;
      }

      for (const guildId of guildIds) {
        await this.syncGuild(client, guildId);
      }
    });

    this.client.on(Events.GuildCreate, async (guild) => {
      this.logger.info({ guildId: guild.id, guildName: guild.name }, '新しいGuildへ参加しました');
      await this.syncGuild(this.client, guild.id);
    });

    this.client.on(Events.GuildDelete, async (guild) => {
      this.logger.info({ guildId: guild.id, guildName: guild.name }, 'Guildから退出しました');
      await this.pluginLoader.disableGuildPlugins(guild.id);
      this.pluginCache.invalidate(guild.id);
      this.pluginCommands.delete(guild.id);
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      let command = this.registry.get(interaction.commandName);

      // Plugin CommandはGuild単位設定を参照する。キャッシュTTL経過後の無効化・設定変更を
      // 実行時にも反映できるよう、GuildごとのRuntimeから再取得する。
      if (!command && interaction.guildId) {
        const commands = await this.pluginLoader.getGuildCommands(interaction.guildId);
        this.pluginCommands.set(interaction.guildId, commands);
        command = commands.find(
          (candidate) => candidate.definition.name === interaction.commandName,
        );
      }

      if (!command) {
        this.logger.warn(
          {
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
          },
          '不明または無効な Slash Command が実行されました',
        );
        await this.replyEphemeral(interaction, 'このコマンドは現在利用できません');
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

  private resolveInitialSyncGuildIds(client: Client): string[] {
    const cachedGuildIds = [...client.guilds.cache.keys()];
    const devGuildId = process.env['DISCORD_GUILD_ID_DEV'];

    if (process.env.NODE_ENV !== 'production' && devGuildId) {
      return [devGuildId];
    }

    return cachedGuildIds;
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

    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      this.logger.warn('REDIS_URLが未設定のためPlugin Runtimeイベント購読を無効化します');
      return;
    }
    try {
      await this.runtimeEvents.start(redisUrl);
    } catch (error) {
      this.logger.error(
        { err: error },
        'Plugin Runtimeイベント購読の開始に失敗しました。TTL同期で継続します',
      );
    }
  }

  /** Bot を停止する */
  async stop(): Promise<void> {
    await this.runtimeEvents.stop();
    const guildIds = [...this.client.guilds.cache.keys()];
    const results = await Promise.allSettled(
      guildIds.map((guildId) => this.pluginLoader.disableGuildPlugins(guildId)),
    );
    const rejected = results.filter((result) => result.status === 'rejected').length;
    if (rejected > 0) {
      this.logger.warn({ rejected }, '停止時に一部Pluginの無効化処理が失敗しました');
    }

    this.pluginCache.invalidateAll();
    this.pluginCommands.clear();
    this.client.destroy();
    this.logger.info('Bot を停止しました');
  }

  /** Plugin設定変更時にGuildのCommand一覧を再構築する。 */
  async resyncGuild(guildId: string): Promise<void> {
    await this.pluginLoader.disableGuildPlugins(guildId);
    this.pluginCache.invalidate(guildId);
    await this.syncGuild(this.client, guildId);
  }
}
