import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Redis } from 'ioredis';
import {
  getPrismaClient,
  recordCommandExecution as persistCommandExecution,
  type CommandExecutionInput,
} from '@herta/db';
import { getEnabledPlugins } from '@herta/plugin-catalog';
import { HERTA_WORKER_HEARTBEAT_KEY } from '@herta/shared';
import type { Logger } from '@herta/logger';
import { pingCommand } from './commands/ping.js';
import { CommandRegistry } from './commands/registry.js';
import { defaultGuildPluginCache } from './plugins/cache.js';
import { GuildPluginLoader } from './plugins/loader.js';
import { createDefaultPluginRegistry } from './plugins/registry.js';
import { PluginRuntimeEventSubscriber } from './plugins/runtime-events.js';
import { syncGuildCommands } from './plugins/sync.js';
import type { SlashCommand } from './commands/registry.js';
import { DiscordHealthTracker } from './health/discord-state.js';
import {
  loadGuildConfigurationOptions,
  type GuildConfigurationOptions,
} from './health/guild-options.js';
import type { DiscordHealthObservation } from './health/types.js';
import { searchGuildMemberOptions, type GuildMemberOption } from './health/guild-members.js';

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'UnknownError';
}

function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

function messageContentIntentEnabled(): boolean {
  return envFlagEnabled('DISCORD_ENABLE_MESSAGE_CONTENT_INTENT');
}

function guildMembersIntentEnabled(): boolean {
  return envFlagEnabled('DISCORD_ENABLE_GUILD_MEMBERS_INTENT');
}

function resolveGatewayIntents(logger: Logger): GatewayIntentBits[] {
  const intents = [GatewayIntentBits.Guilds];
  if (messageContentIntentEnabled()) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    logger.info('Auto Response / Moderation用Message Content Intentを有効化します');
  } else {
    logger.warn(
      'DISCORD_ENABLE_MESSAGE_CONTENT_INTENTが無効なためメッセージ系Pluginは実行されません',
    );
  }
  if (guildMembersIntentEnabled()) {
    intents.push(GatewayIntentBits.GuildMembers);
    logger.info('Moderationブラックリスト再参加監視用Guild Members Intentを有効化します');
  } else {
    logger.warn(
      'DISCORD_ENABLE_GUILD_MEMBERS_INTENTが無効なためブラックリスト再参加BANは実行されません',
    );
  }
  return intents;
}

/** Herta Bot クライアント */
export class HertaBot {
  private client: Client;
  private registry: CommandRegistry;
  private readonly prisma = getPrismaClient();
  private readonly pluginCache = defaultGuildPluginCache;
  private readonly pluginLoader: GuildPluginLoader;
  private readonly pluginCommands = new Map<string, SlashCommand[]>();
  private readonly runtimeEvents: PluginRuntimeEventSubscriber;
  private readonly discordHealth = new DiscordHealthTracker();
  private readonly gatewayObservationIntervalMs: number;
  private gatewayObservationTimer?: NodeJS.Timeout;
  private healthRedis?: Redis;

  constructor(
    private logger: Logger,
    heartbeatStaleMs = 120_000,
  ) {
    this.gatewayObservationIntervalMs = Math.max(
      5_000,
      Math.min(30_000, Math.floor(heartbeatStaleMs / 3)),
    );
    this.client = new Client({
      intents: resolveGatewayIntents(this.logger),
      partials: [Partials.Message],
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
      this.discordHealth.markReady();
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

    this.client.on(Events.ShardReady, () => {
      this.discordHealth.markResumed();
    });
    this.client.on(Events.ShardResume, () => {
      this.discordHealth.markResumed();
    });
    this.client.on(Events.ShardReconnecting, () => {
      this.discordHealth.markReconnecting();
    });
    this.client.on(Events.ShardDisconnect, () => {
      this.discordHealth.markDisconnected();
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

    this.client.on(Events.GuildMemberAdd, async (member) => {
      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberAdd, member);
    });

    this.client.on(Events.GuildMemberRemove, async (member) => {
      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberRemove, member);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guildId) return;

      let events: Awaited<ReturnType<typeof this.pluginLoader.getGuildEvents>>;
      try {
        events = await this.pluginLoader.getGuildEvents(message.guildId);
      } catch (error) {
        this.logger.error(
          { err: error, guildId: message.guildId, channelId: message.channelId },
          'Guild Plugin Eventの取得に失敗しました',
        );
        return;
      }

      const handlers = events.filter((event) => event.event === Events.MessageCreate);
      for (const event of handlers) {
        try {
          await event.handler(message);
        } catch (error) {
          this.logger.error(
            {
              err: error,
              guildId: message.guildId,
              channelId: message.channelId,
              event: event.event,
            },
            'Plugin Event Handlerの実行に失敗しました',
          );
        }
      }
    });

    this.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
      let updatedMessage = newMessage;
      if (newMessage.partial) {
        try {
          updatedMessage = await newMessage.fetch();
        } catch (error) {
          this.logger.warn(
            { err: error, messageId: newMessage.id, channelId: newMessage.channelId },
            '編集メッセージの取得に失敗したためPlugin再判定をスキップします',
          );
          return;
        }
      }

      const guildId = updatedMessage.guildId ?? oldMessage.guildId;
      if (!guildId) return;
      await this.dispatchGuildPluginEvent(
        guildId,
        Events.MessageUpdate,
        oldMessage,
        updatedMessage,
      );
    });

    this.client.on(Events.MessageDelete, async (message) => {
      if (!message.guildId) return;
      await this.dispatchGuildPluginEvent(message.guildId, Events.MessageDelete, message);
    });

    this.client.on('error', (error) => {
      this.logger.error(error, 'Discord クライアントエラー');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.guildId) {
        const dispatch = await this.dispatchGuildPluginEvent(
          interaction.guildId,
          Events.InteractionCreate,
          interaction,
        );
        if (
          dispatch.failed &&
          !interaction.isChatInputCommand() &&
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content: 'Plugin操作の処理中にエラーが発生しました',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }
      if (!interaction.isChatInputCommand()) return;

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

      const startedAt = Date.now();
      let status: CommandExecutionInput['status'] = 'success';
      let errorName: string | null = null;

      try {
        await command.execute(interaction);
      } catch (error) {
        status = 'failure';
        errorName = resolveErrorName(error);
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
      } finally {
        await this.recordCommandExecution({
          guildId: interaction.guildId,
          commandName: interaction.commandName,
          status,
          durationMs: Date.now() - startedAt,
          errorName,
        });
      }
    });
  }

  private async dispatchGuildPluginEvent(
    guildId: string,
    eventName: string,
    ...payloads: unknown[]
  ): Promise<{ matched: number; failed: boolean }> {
    try {
      const events = await this.pluginLoader.getGuildEvents(guildId);
      const handlers = events.filter((candidate) => candidate.event === eventName);
      let failed = false;
      for (const event of handlers) {
        try {
          await event.handler(...payloads);
        } catch (error) {
          failed = true;
          this.logger.error(
            { err: error, guildId, event: eventName },
            'Plugin Event Handlerの実行に失敗しました',
          );
        }
      }
      return { matched: handlers.length, failed };
    } catch (error) {
      this.logger.error(
        { err: error, guildId, event: eventName },
        'Guild Plugin Eventの取得に失敗しました',
      );
      return { matched: 0, failed: true };
    }
  }

  private async recordCommandExecution(input: CommandExecutionInput): Promise<void> {
    try {
      await persistCommandExecution(this.prisma, input);
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          guildId: input.guildId,
          commandName: input.commandName,
          status: input.status,
        },
        'コマンド利用状況の記録に失敗しました',
      );
    }
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

    this.discordHealth.observe(this.client);
    this.gatewayObservationTimer = setInterval(() => {
      this.discordHealth.observe(this.client);
    }, this.gatewayObservationIntervalMs);
    this.gatewayObservationTimer.unref();

    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      this.logger.warn('REDIS_URLが未設定のためPlugin Runtimeイベント購読を無効化します');
      return;
    }

    this.healthRedis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    this.healthRedis.on('error', () => {
      this.logger.warn('ヘルスチェック用Redis接続でエラーが発生しました');
    });
    try {
      await this.healthRedis.connect();
    } catch {
      this.logger.warn('ヘルスチェック用Redisの初期接続に失敗しました');
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

  async getGuildConfigurationOptions(guildId: string): Promise<GuildConfigurationOptions | null> {
    return loadGuildConfigurationOptions(this.client, guildId);
  }

  async searchGuildMembers(
    guildId: string,
    query: string,
    limit: number,
  ): Promise<GuildMemberOption[] | null> {
    return searchGuildMemberOptions(this.client, guildId, query, limit);
  }

  getDiscordHealthObservation(): DiscordHealthObservation {
    return this.discordHealth.snapshot(this.client);
  }

  getGuildCount(): number {
    return this.client.guilds.cache.size;
  }

  async probeDatabase(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async probeRedis(): Promise<void> {
    if (!this.healthRedis) throw new Error('Redis is not configured');
    await this.healthRedis.ping();
  }

  async getWorkerHeartbeat(): Promise<string | null> {
    if (!this.healthRedis) throw new Error('Redis is not configured');
    return this.healthRedis.get(HERTA_WORKER_HEARTBEAT_KEY);
  }

  /** Bot を停止する */
  async stop(): Promise<void> {
    if (this.gatewayObservationTimer) {
      clearInterval(this.gatewayObservationTimer);
      this.gatewayObservationTimer = undefined;
    }

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

    const healthRedis = this.healthRedis;
    this.healthRedis = undefined;
    if (healthRedis) {
      await healthRedis.quit().catch(() => healthRedis.disconnect());
    }
    await this.prisma.$disconnect().catch(() => undefined);

    this.client.destroy();
    this.discordHealth.markDisconnected();
    this.logger.info('Bot を停止しました');
  }

  /** Plugin設定変更時にGuildのCommand一覧を再構築する。 */
  async resyncGuild(guildId: string): Promise<void> {
    await this.pluginLoader.disableGuildPlugins(guildId);
    this.pluginCache.invalidate(guildId);
    await this.syncGuild(this.client, guildId);
  }
}
