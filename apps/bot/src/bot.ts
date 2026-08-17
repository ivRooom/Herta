import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Redis } from 'ioredis';
import {
  getPrismaClient,
  recordCommandExecution as persistCommandExecution,
  type CommandExecutionInput,
} from '@herta/db';
import { getEnabledPlugins } from '@herta/plugin-catalog';
import {
  DEFAULT_BOT_PRESENCE_CONFIG,
  HERTA_STUDIO_ROOT_DISCORD_ROLE_ID,
  HERTA_WORKER_HEARTBEAT_KEY,
  type BotPresenceConfig,
  type XpRoleSweepEvent,
} from '@herta/shared';
import type { Logger } from '@herta/logger';
import { pingCommand } from './commands/ping.js';
import { CommandRegistry } from './commands/registry.js';
import { defaultGuildPluginCache } from './plugins/cache.js';
import { GuildPluginLoader } from './plugins/loader.js';
import { createDefaultPluginRegistry } from './plugins/registry.js';
import { PluginRuntimeEventSubscriber } from './plugins/runtime-events.js';
import { BotPresenceEventSubscriber } from './presence/runtime-events.js';
import { loadStoredBotPresence } from './presence/store.js';
import { XpRoleReconciliationSubscriber } from './plugins/xp-role-reconciliation-events.js';
import { XpRoleSweepSubscriber } from './plugins/xp-role-sweep-events.js';
import { sweepGuildXpRewardRoles } from './plugins/xp-role-sweep.js';
import { getXpProfile } from './plugins/xp-level-repository.js';
import { levelForXp, normalizeXpLevelConfig } from './plugins/xp-level.js';
import {
  reconcileXpRewardRoles as reconcileXpRewardRolesForMember,
  type XpRewardRoleReconciliationResult,
} from './plugins/xp-reward-roles.js';
import { syncGuildCommands } from './plugins/sync.js';
import type { SlashCommand } from './commands/registry.js';
import { DiscordHealthTracker } from './health/discord-state.js';
import {
  loadGuildConfigurationOptions,
  type GuildConfigurationOptions,
} from './health/guild-options.js';
import type { DiscordHealthObservation } from './health/types.js';
import {
  finishVoiceSession,
  incrementCommunityActivity,
  resetVoiceSessions,
  startVoiceSession,
} from './activity/community-activity.js';
import {
  hasMessageCooldownElapsed,
  normalizeActivityRulesConfig,
  shouldCountMessage,
  shouldCountVoice,
  type ActivityRulesConfig,
} from './activity/activity-rules.js';
import { searchGuildMemberOptions, type GuildMemberOption } from './health/guild-members.js';
import {
  getGuildBotProfile as getDiscordGuildBotProfile,
  updateGuildBotProfile as updateDiscordGuildBotProfile,
  type GuildBotProfile,
  type GuildBotProfileUpdate,
} from './profile/guild-bot-profile.js';

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return 'UnknownError';
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
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

export interface RuleRuntimeEventSink {
  memberJoined(input: { guildId: string; userId: string; joinedAt: Date }): Promise<void>;
}

const BOT_ACTIVITY_TYPE_MAP: Record<BotPresenceConfig['activityType'], ActivityType> = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
};

function resolveGatewayIntents(logger: Logger): GatewayIntentBits[] {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ];
  if (messageContentIntentEnabled()) {
    intents.push(GatewayIntentBits.MessageContent);
    logger.info('Auto Response / Moderation用Message Content Intentを有効化します');
  } else {
    logger.warn(
      'DISCORD_ENABLE_MESSAGE_CONTENT_INTENTが無効なためメッセージ系Pluginは実行されません',
    );
  }
  if (guildMembersIntentEnabled()) {
    intents.push(GatewayIntentBits.GuildMembers);
    logger.info('Moderation / member.joined Rule用Guild Members Intentを有効化します');
  } else {
    logger.warn(
      'DISCORD_ENABLE_GUILD_MEMBERS_INTENTが無効なためブラックリスト再参加BAN / member.joined Ruleは実行されません',
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
  private readonly presenceEvents: BotPresenceEventSubscriber;
  private readonly xpRoleReconciliation: XpRoleReconciliationSubscriber;
  private readonly xpRoleSweep: XpRoleSweepSubscriber;
  private readonly discordHealth = new DiscordHealthTracker();
  private readonly gatewayObservationIntervalMs: number;
  private gatewayObservationTimer?: NodeJS.Timeout;
  private healthRedis?: Redis;
  private readonly activityMessageLastCountedAt = new Map<string, number>();
  private ruleRuntimeEvents?: RuleRuntimeEventSink;

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
      partials: [Partials.Message, Partials.Reaction, Partials.User],
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
    this.presenceEvents = new BotPresenceEventSubscriber(
      (config) => this.applyBotPresence(config),
      this.logger,
    );
    this.xpRoleReconciliation = new XpRoleReconciliationSubscriber(async (guildId, userId) => {
      await this.reconcileXpRewardRoles(guildId, userId);
    }, this.logger);
    this.xpRoleSweep = new XpRoleSweepSubscriber(async (event) => {
      await this.reconcileGuildXpRewardRoles(event);
    }, this.logger);
    pluginRegistry.validateAll(this.logger);
    pluginRegistry.validateAgainstCatalog(this.logger);

    this.setupEventHandlers();
  }

  setRuleRuntimeEventSink(sink: RuleRuntimeEventSink | undefined): void {
    this.ruleRuntimeEvents = sink;
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
        try {
          await resetVoiceSessions(this.prisma, guildId);
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            const activityRules = await this.getActivityRules(guildId);
            for (const state of guild.voiceStates.cache.values()) {
              if (state.member?.user.bot || !this.isCountableVoiceState(state, activityRules))
                continue;
              await startVoiceSession(this.prisma, guildId, state.id, state.channelId!);
            }
          }
        } catch (error) {
          this.logger.warn({ err: error, guildId }, 'VCセッション初期化に失敗しました');
        }
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
      for (const key of this.activityMessageLastCountedAt.keys()) {
        if (key.startsWith(`${guild.id}:`)) this.activityMessageLastCountedAt.delete(key);
      }
    });

    this.client.on(Events.GuildMemberAdd, async (member) => {
      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberAdd, member);
      if (member.user.bot || !this.ruleRuntimeEvents) return;
      if (member.joinedTimestamp === null) {
        this.logger.warn(
          { guildId: member.guild.id, userId: member.id },
          'member.joined Ruleの安定したexecution IDを作れないため実行をスキップしました',
        );
        return;
      }
      try {
        await this.ruleRuntimeEvents.memberJoined({
          guildId: member.guild.id,
          userId: member.id,
          joinedAt: new Date(member.joinedTimestamp),
        });
      } catch (error) {
        this.logger.error(
          { err: error, guildId: member.guild.id, userId: member.id },
          'member.joined Ruleの実行に失敗しました',
        );
      }
    });

    this.client.on(Events.GuildMemberRemove, async (member) => {
      await this.dispatchGuildPluginEvent(member.guild.id, Events.GuildMemberRemove, member);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.guildId) return;
      if (!message.author.bot && !message.webhookId) {
        try {
          const activityRules = await this.getActivityRules(message.guildId);
          const now = Date.now();
          const cooldownKey = `${message.guildId}:${message.author.id}`;
          const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
          if (
            shouldCountMessage(activityRules, {
              channelId: message.channelId,
              roleIds,
              contentAvailable: messageContentIntentEnabled(),
              content: message.content,
              contentLength: message.content.length,
            }) &&
            hasMessageCooldownElapsed(
              activityRules,
              this.activityMessageLastCountedAt.get(cooldownKey),
              now,
            )
          ) {
            await incrementCommunityActivity(
              this.prisma,
              message.guildId,
              message.author.id,
              'messages',
            );
            this.activityMessageLastCountedAt.set(cooldownKey, now);
          }
        } catch (error) {
          this.logger.warn(
            { err: error, guildId: message.guildId, userId: message.author.id },
            '発言数の記録に失敗しました',
          );
        }
      }

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

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (user.bot) return;
      let resolvedReaction;
      try {
        resolvedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const resolvedMessage = resolvedReaction.message.partial
          ? await resolvedReaction.message.fetch()
          : resolvedReaction.message;
        const guildId = resolvedMessage.guildId;
        if (!guildId) return;

        try {
          const activityRules = await this.getActivityRules(guildId);
          const giver = resolvedMessage.guild?.members.cache.get(user.id);
          const giverAllowed = shouldCountMessage(activityRules, {
            channelId: resolvedMessage.channelId,
            roleIds: giver ? [...giver.roles.cache.keys()] : [],
            contentAvailable: false,
          });
          if (giverAllowed && activityRules.countReactionsGiven) {
            await incrementCommunityActivity(this.prisma, guildId, user.id, 'reactions_given');
          }

          const receiver = resolvedMessage.author;
          const receiverAllowed = shouldCountMessage(activityRules, {
            channelId: resolvedMessage.channelId,
            roleIds: resolvedMessage.member ? [...resolvedMessage.member.roles.cache.keys()] : [],
            contentAvailable: false,
          });
          if (
            receiverAllowed &&
            activityRules.countReactionsReceived &&
            receiver &&
            !receiver.bot &&
            receiver.id !== user.id
          ) {
            await incrementCommunityActivity(
              this.prisma,
              guildId,
              receiver.id,
              'reactions_received',
            );
          }
        } catch (error) {
          this.logger.warn(
            { err: error, guildId, userId: user.id },
            'リアクション活動の記録に失敗しました',
          );
        }

        await this.dispatchGuildPluginEvent(
          guildId,
          Events.MessageReactionAdd,
          resolvedReaction,
          user,
        );
      } catch (error) {
        this.logger.warn({ err: error, userId: user.id }, 'リアクションの取得に失敗しました');
      }
    });

    this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
      const guildId = newState.guild.id;
      const userId = newState.id;
      if (newState.member?.user.bot ?? oldState.member?.user.bot) return;

      try {
        const activityRules = await this.getActivityRules(guildId);
        const oldEligible = this.isCountableVoiceState(oldState, activityRules);
        const newEligible = this.isCountableVoiceState(newState, activityRules);
        const channelChanged = oldState.channelId !== newState.channelId;

        if (oldEligible && (!newEligible || channelChanged)) {
          await finishVoiceSession(this.prisma, guildId, userId);
        }
        if (newEligible && (!oldEligible || channelChanged)) {
          await startVoiceSession(this.prisma, guildId, userId, newState.channelId!);
        }
      } catch (error) {
        this.logger.warn({ err: error, guildId, userId }, 'VC滞在時間の記録に失敗しました');
      }

      await this.dispatchGuildPluginEvent(guildId, Events.VoiceStateUpdate, oldState, newState);
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

  private async getActivityRules(guildId: string): Promise<ActivityRulesConfig> {
    return normalizeActivityRulesConfig(
      await this.pluginLoader.getGuildPluginConfig(guildId, 'activity-rules'),
    );
  }

  private isCountableVoiceState(
    state: {
      channelId: string | null;
      selfMute?: boolean | null;
      serverMute?: boolean | null;
      selfDeaf?: boolean | null;
      serverDeaf?: boolean | null;
      member?: { roles: { cache: Map<string, unknown> } } | null;
    },
    config: ActivityRulesConfig,
  ): boolean {
    return shouldCountVoice(config, {
      channelId: state.channelId,
      roleIds: state.member ? [...state.member.roles.cache.keys()] : [],
      selfMute: state.selfMute,
      serverMute: state.serverMute,
      selfDeaf: state.selfDeaf,
      serverDeaf: state.serverDeaf,
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
    this.applyBotPresence(DEFAULT_BOT_PRESENCE_CONFIG);
    try {
      this.applyBotPresence(await loadStoredBotPresence(this.prisma));
    } catch (error) {
      this.logger.warn({ err: error }, '保存済みBot Presence設定のDB読み込みに失敗しました');
    }

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

    try {
      await this.presenceEvents.start(redisUrl);
    } catch (error) {
      this.logger.error(
        { err: error },
        'Bot Presenceイベント購読の開始に失敗しました。保存済みPresenceで継続します',
      );
    }

    try {
      await this.xpRoleReconciliation.start(redisUrl);
    } catch (error) {
      this.logger.error(
        { err: error },
        'XP報酬Role再同期イベント購読の開始に失敗しました。XP更新自体は継続します',
      );
    }

    try {
      await this.xpRoleSweep.start(redisUrl);
    } catch (error) {
      this.logger.error({ err: error }, 'XP報酬Role一括修復イベント購読の開始に失敗しました');
    }
  }

  private applyBotPresence(config: BotPresenceConfig): void {
    const user = this.client.user;
    if (!user) {
      this.logger.warn('Discord ClientがReadyではないためBot Presenceを適用できません');
      return;
    }

    user.setPresence({
      status: config.status,
      activities: [
        {
          name: config.activityText,
          type: BOT_ACTIVITY_TYPE_MAP[config.activityType],
        },
      ],
    });
    this.logger.info(
      { status: config.status, activityType: config.activityType },
      'Bot Presenceを更新しました',
    );
  }

  async getGuildBotProfile(guildId: string): Promise<GuildBotProfile | null> {
    return getDiscordGuildBotProfile(this.client, guildId);
  }

  async updateGuildBotProfile(
    guildId: string,
    input: GuildBotProfileUpdate,
  ): Promise<GuildBotProfile | null> {
    return updateDiscordGuildBotProfile(this.client, guildId, input);
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

  async addRuleMemberRole(input: {
    guildId: string;
    userId: string;
    roleId: string;
    actorId: string;
    ruleId: string;
    triggerExecutionId: string;
  }): Promise<{ status: 'added' | 'already-present'; auditRecorded: boolean }> {
    if (input.roleId === HERTA_STUDIO_ROOT_DISCORD_ROLE_ID) {
      throw namedError('DiscordMemberRoleRootProtected');
    }

    const guild = this.client.guilds.cache.get(input.guildId);
    if (!guild) throw namedError('DiscordGuildNotAvailable');

    let botMember = guild.members.me;
    if (!botMember) {
      try {
        botMember = await guild.members.fetchMe();
      } catch (error) {
        this.logger.warn(
          { err: error, guildId: input.guildId },
          'Bot member状態を取得できませんでした',
        );
        throw namedError('DiscordBotMemberNotAvailable');
      }
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw namedError('DiscordManageRolesPermissionMissing');
    }

    let role;
    try {
      role = await guild.roles.fetch(input.roleId);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId: input.guildId, roleId: input.roleId },
        'Rule Role付与対象の取得に失敗しました',
      );
      throw namedError('DiscordRoleNotAvailable');
    }
    if (!role) throw namedError('DiscordRoleNotAvailable');
    if (role.managed || !role.editable) throw namedError('DiscordRoleNotAssignable');

    let member;
    try {
      member = await guild.members.fetch(input.userId);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId: input.guildId, userId: input.userId },
        'Rule Role付与対象memberの取得に失敗しました',
      );
      throw namedError('DiscordMemberNotAvailable');
    }
    if (member.user.bot) throw namedError('DiscordBotMemberRoleAssignmentDenied');
    if (member.roles.cache.has(input.roleId)) {
      return { status: 'already-present', auditRecorded: true };
    }
    if (!member.manageable) throw namedError('DiscordMemberNotManageable');

    try {
      await member.roles.add(role, `Herta Rule ${input.ruleId}`);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId: input.guildId, userId: input.userId, roleId: input.roleId },
        'RuleからDiscord Roleを付与できませんでした',
      );
      throw namedError('DiscordMemberRoleAddFailed');
    }

    let auditRecorded = true;
    try {
      await this.prisma.auditLog.create({
        data: {
          guildId: input.guildId,
          actorId: input.actorId,
          event: 'rule.member_role_added',
          targetType: 'member',
          targetId: input.userId,
          changes: { roleId: input.roleId, status: 'added' },
          severity: 'warning',
          metadata: {
            ruleId: input.ruleId,
            triggerExecutionId: input.triggerExecutionId,
            operationSource: 'rule-engine',
            securitySensitive: true,
          },
        },
      });
    } catch (error) {
      auditRecorded = false;
      this.logger.error(
        {
          err: error,
          guildId: input.guildId,
          userId: input.userId,
          roleId: input.roleId,
          ruleId: input.ruleId,
        },
        'Rule Role付与のAudit Log保存に失敗しました',
      );
    }

    return { status: 'added', auditRecorded };
  }

  async reconcileXpRewardRoles(
    guildId: string,
    userId: string,
  ): Promise<XpRewardRoleReconciliationResult | null> {
    const rawConfig = await this.pluginLoader.getGuildPluginConfig(guildId, 'xp-level');
    if (!rawConfig) {
      this.logger.debug(
        { guildId, userId },
        'XP / Level Pluginが無効なため報酬Role再同期をスキップします',
      );
      return null;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.logger.warn(
        { guildId, userId },
        'GuildがBot cacheにないためXP報酬Role再同期をスキップします',
      );
      return null;
    }

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId, userId },
        '対象メンバーを取得できないためXP報酬Role再同期をスキップします',
      );
      return null;
    }

    const profile = await getXpProfile(this.prisma, guildId, userId);
    const level = levelForXp(profile?.xp ?? 0);
    const result = await reconcileXpRewardRolesForMember({
      member,
      config: normalizeXpLevelConfig(rawConfig),
      level,
      logger: this.logger,
    });
    this.logger.info(
      {
        guildId,
        userId,
        level,
        added: result.addedRoleIds.length,
        removed: result.removedRoleIds.length,
        skipped: result.skippedRoleIds.length,
        failed: result.failedRoleIds.length,
      },
      'XP報酬Roleの再同期を完了しました',
    );
    return result;
  }

  async reconcileGuildXpRewardRoles(event: XpRoleSweepEvent): Promise<void> {
    const { guildId, requestId } = event;
    const fail = async (failureCode: string): Promise<void> => {
      await this.prisma.auditLog.create({
        data: {
          guildId,
          actorId: event.actorId,
          event: 'leaderboard.xp_role_sweep_failed',
          targetType: 'guild',
          targetId: guildId,
          severity: 'warning',
          metadata: {
            requestId,
            reason: event.reason,
            operationSource: 'bot',
            failureCode,
          },
        },
      });
    };

    if (!guildMembersIntentEnabled()) {
      this.logger.warn(
        { guildId, requestId },
        'Guild Members Intentが無効なためXP報酬Role一括修復を実行できません',
      );
      await fail('guild_members_intent_disabled');
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      await fail('guild_not_cached');
      return;
    }

    const plugin = await this.prisma.guildPlugin.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: 'xp-level' } },
      select: { enabled: true, config: true },
    });
    if (!plugin?.enabled) {
      await fail('xp_level_plugin_disabled');
      return;
    }

    try {
      const result = await sweepGuildXpRewardRoles({
        guild,
        prisma: this.prisma,
        config: normalizeXpLevelConfig(plugin.config),
        logger: this.logger,
      });
      await this.prisma.auditLog.create({
        data: {
          guildId,
          actorId: event.actorId,
          event: 'leaderboard.xp_role_sweep_completed',
          targetType: 'guild',
          targetId: guildId,
          severity: result.failedRoles > 0 ? 'warning' : 'info',
          changes: result,
          metadata: {
            requestId,
            reason: event.reason,
            operationSource: 'bot',
            result,
          },
        },
      });
      this.logger.info({ guildId, requestId, ...result }, 'XP報酬Role一括修復を完了しました');
    } catch (error) {
      this.logger.error(
        { err: error, guildId, requestId },
        'XP報酬Role一括修復の実行に失敗しました',
      );
      await fail('sweep_execution_failed');
    }
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

    await Promise.allSettled([
      this.runtimeEvents.stop(),
      this.presenceEvents.stop(),
      this.xpRoleReconciliation.stop(),
      this.xpRoleSweep.stop(),
    ]);
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
