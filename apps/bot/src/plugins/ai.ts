import { recordAiGenerationEvent, type PrismaClient } from '@herta/db';
import { createLogger, type Logger } from '@herta/logger';
import { aiManifest } from '@herta/plugin-catalog';
import { resolveAiArtifactConfig } from '@herta/plugin-catalog/ai-artifact';
import type { AiTelemetryEvent } from '@herta/plugin-catalog/ai-service';
import {
  definePlugin,
  type CommandHandler,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import { MessageFlags, type ChatInputCommandInteraction, type Client } from 'discord.js';
import { Redis } from 'ioredis';
import { clearAkinatorGuildSessions, createAkinatorCommandHandler } from '../ai/akinator-game.js';
import { AiArtifactRuntime } from '../ai/artifact-runtime.js';
import {
  getVerifiedAiReplyContext,
  isAiArtifactMessageCandidate,
  normalizeAiTriggerRoleId,
  verifyAiReplyToBot,
  type AiArtifactDiscordMessage,
} from '../ai/artifact-message-handler.js';
import { handleAiConversationMessage } from '../ai/conversation-message-handler.js';
import {
  withAiDirectReplyCodeExecutionContext,
  withAiDirectReplyContext,
  withAiDirectReplyImageGenerationContext,
} from '../ai/direct-reply-context.js';
import { createAiFoundationRuntime } from '../ai/factory.js';
import { withAiJmaWeatherGroundingContext } from '../ai/jma-weather-service.js';
import type { AiRuntimeGenerationService } from '../ai/runtime-service.js';
import { startAiTypingIndicator } from '../ai/typing-indicator.js';

export interface AiPluginConfig {
  enabled: boolean;
  triggerRoleId?: string | null;
  imageGenerationEnabled?: boolean;
  codeExecutionEnabled?: boolean;
  weatherGroundingEnabled?: boolean;
}

export interface NormalizedAiPluginConfig {
  enabled: boolean;
  triggerRoleId: string | null;
  imageGenerationEnabled: boolean;
  codeExecutionEnabled: boolean;
  weatherGroundingEnabled: boolean;
}

/** 既定は従来どおり全機能有効(`!== false`)。古いGuild configに新フィールドが無くても壊れない。 */
export function normalizeAiPluginConfig(value: AiPluginConfig): NormalizedAiPluginConfig {
  return {
    enabled: value.enabled === true,
    triggerRoleId: normalizeAiTriggerRoleId(value.triggerRoleId ?? null),
    imageGenerationEnabled: value.imageGenerationEnabled !== false,
    codeExecutionEnabled: value.codeExecutionEnabled !== false,
    weatherGroundingEnabled: value.weatherGroundingEnabled !== false,
  };
}

type AiPluginRuntimeContext = PluginRuntimeContext<AiPluginConfig, Client, PrismaClient>;

interface AiArtifactFeatureOverrides {
  imageGenerationEnabled?: boolean;
  codeExecutionEnabled?: boolean;
}

interface AiPluginSharedRuntime {
  artifactRuntime: AiArtifactRuntime;
  createArtifactRuntime(
    generationService: AiRuntimeGenerationService,
    directReplyContext?: string | null,
    featureOverrides?: AiArtifactFeatureOverrides,
  ): AiArtifactRuntime;
  generationService: AiRuntimeGenerationService;
}

let sharedRuntimePromise: Promise<AiPluginSharedRuntime | null> | undefined;
let sharedRedis: Redis | undefined;
let sharedRuntimeLogger: Logger | undefined;
const enabledGuilds = new Set<string>();

export const aiPlugin = definePlugin<AiPluginConfig, Client, PrismaClient>({
  manifest: aiManifest,
  async onEnable(context) {
    enabledGuilds.add(context.guildId);

    const triggerRoleId = normalizeAiTriggerRoleId(context.config.triggerRoleId);
    if (triggerRoleId && !messageContentIntentEnabled()) {
      context.logger.warn(
        { guildId: context.guildId, triggerRoleConfigured: true },
        'AI Role mention triggerにはDISCORD_ENABLE_MESSAGE_CONTENT_INTENT=trueが必要です',
      );
    }
  },
  async onDisable(context) {
    enabledGuilds.delete(context.guildId);
    clearAkinatorGuildSessions(context.guildId);
    if (enabledGuilds.size === 0) await closeSharedRuntime();
  },
  provideCommands(context) {
    const akinator = createAkinatorCommandHandler(aiManifest.commands[0]!, async () => {
      const runtime = await getSharedRuntime(context);
      return runtime?.generationService ?? null;
    });
    const ask: CommandHandler<ChatInputCommandInteraction> = {
      definition: aiManifest.commands[1]!,
      async execute(interaction) {
        await executeAiAskCommand(context as AiPluginRuntimeContext, interaction);
      },
    };
    return [akinator, ask];
  },
  provideEvents() {
    return [
      {
        event: 'messageCreate',
        async handler(context, ...args) {
          await handleAiMessage(
            context as AiPluginRuntimeContext,
            args[0] as AiArtifactDiscordMessage | undefined,
          );
        },
      },
    ] as PluginEventHandler<AiPluginConfig, Client, PrismaClient>[];
  },
});

async function handleAiMessage(
  context: AiPluginRuntimeContext,
  message: AiArtifactDiscordMessage | undefined,
): Promise<void> {
  const config = normalizeAiPluginConfig(context.config);
  if (!config.enabled) return;

  const botUserId = context.client.user?.id ?? null;
  if (!message || !botUserId || message.guildId !== context.guildId) return;

  const triggerRoleId = config.triggerRoleId;
  const wasCandidateBeforeReplyVerification = isAiArtifactMessageCandidate(
    message,
    botUserId,
    triggerRoleId,
  );
  if (message.reference?.messageId) {
    await verifyAiReplyToBot(message, botUserId);
  }
  if (
    !wasCandidateBeforeReplyVerification &&
    !isAiArtifactMessageCandidate(message, botUserId, triggerRoleId)
  ) {
    return;
  }

  const typingIndicator = startAiTypingIndicator(message, botUserId, context.logger, triggerRoleId);
  const handlerMessage = normalizeConfiguredRoleTriggerMessage(message, botUserId, triggerRoleId);
  try {
    const runtime = await getSharedRuntime(context);
    const directReplyContext = getVerifiedAiReplyContext(message);
    const baseGenerationService = runtime?.generationService
      ? withAiDirectReplyContext(runtime.generationService, directReplyContext)
      : null;
    const generationService =
      baseGenerationService && config.weatherGroundingEnabled
        ? withAiJmaWeatherGroundingContext(baseGenerationService, {
            onLookupFailed: ({ areaDisplayName, errorName }) =>
              context.logger.warn(
                {
                  guildId: context.guildId,
                  areaDisplayName,
                  errorName,
                  result: 'jma_lookup_failed',
                },
                'JMA天気データの取得に失敗しました',
              ),
          })
        : baseGenerationService;
    let artifactRuntime = runtime?.artifactRuntime ?? null;
    const needsScopedArtifactRuntime =
      Boolean(directReplyContext) || !config.imageGenerationEnabled || !config.codeExecutionEnabled;
    if (runtime && generationService && needsScopedArtifactRuntime) {
      artifactRuntime = runtime.createArtifactRuntime(generationService, directReplyContext, {
        imageGenerationEnabled: config.imageGenerationEnabled,
        codeExecutionEnabled: config.codeExecutionEnabled,
      });
    }
    const result = await handleAiConversationMessage(handlerMessage, {
      runtime: artifactRuntime,
      generationService,
      botUserId,
      getAiPluginConfig: async (guildId) =>
        guildId === context.guildId
          ? ({ enabled: config.enabled } as Record<string, unknown>)
          : null,
    });

    if (result.status === 'handled') {
      context.logger.info(
        {
          guildId: context.guildId,
          intent: result.intent,
          responseMode: result.responseMode ?? null,
          groundingState: result.groundingState ?? null,
          result: 'handled',
        },
        'AI Discord requestを処理しました',
      );
    } else if (result.status === 'failed') {
      context.logger.warn(
        { guildId: context.guildId, category: result.category, result: 'failed' },
        'AI Discord requestを安全に処理できませんでした',
      );
    }
  } catch (error) {
    // Discord SDK errors can carry request payload details. Never pass the raw error object to
    // structured logging because conversation text or attachment bytes can be retained there.
    context.logger.warn(
      {
        guildId: context.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        result: 'delivery_failed',
      },
      'AI Discord deliveryに失敗しました',
    );
  } finally {
    typingIndicator.stop();
  }
}

/**
 * `/ai ask`はmention無しでメッセージ会話経路を呼び出す入り口。既存のcandidate判定・strip処理を
 * そのまま再利用するため、実在のmentionメッセージと同じ形（botへのmention token入りcontent、
 * mentions.users.has(botUserId) === true）の合成messageを組み立てて同じhandlerへ渡す。
 */
async function executeAiAskCommand(
  context: AiPluginRuntimeContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== context.guildId) {
    await interaction.reply({
      content: 'サーバー内でのみ利用できます。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const config = normalizeAiPluginConfig(context.config);
  if (!config.enabled) {
    await interaction.reply({
      content: 'Herta AIは現在このサーバーで無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botUserId = context.client.user?.id ?? null;
  if (!botUserId) {
    await interaction.reply({
      content: '現在Herta AIを利用できません。しばらくしてから再度お試しください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prompt = interaction.options.getString('prompt', true).trim();
  if (!prompt) {
    await interaction.reply({
      content: 'promptを入力してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const guildId = interaction.guildId;
  const syntheticMessage: AiArtifactDiscordMessage = {
    guildId,
    channelId: interaction.channelId,
    content: `<@${botUserId}> ${prompt}`,
    webhookId: null,
    author: { id: interaction.user.id, bot: false },
    member: interaction.member ?? null,
    mentions: {
      users: { has: (userId: string) => userId === botUserId },
      roles: { has: () => false },
    },
    reference: null,
    async reply(options) {
      return interaction.editReply(options as Parameters<typeof interaction.editReply>[0]);
    },
  };

  try {
    const runtime = await getSharedRuntime(context);
    if (!runtime?.generationService) {
      await interaction.editReply({
        content: '現在Herta AIを利用できません。しばらくしてから再度お試しください。',
      });
      return;
    }

    const generationService = config.weatherGroundingEnabled
      ? withAiJmaWeatherGroundingContext(runtime.generationService, {
          onLookupFailed: ({ areaDisplayName, errorName }) =>
            context.logger.warn(
              { guildId, areaDisplayName, errorName, result: 'jma_lookup_failed' },
              'JMA天気データの取得に失敗しました',
            ),
        })
      : runtime.generationService;
    const artifactRuntime = runtime.createArtifactRuntime(generationService, null, {
      imageGenerationEnabled: config.imageGenerationEnabled,
      codeExecutionEnabled: config.codeExecutionEnabled,
    });

    const result = await handleAiConversationMessage(syntheticMessage, {
      runtime: artifactRuntime,
      generationService,
      botUserId,
      getAiPluginConfig: async (lookupGuildId) =>
        lookupGuildId === context.guildId
          ? ({ enabled: config.enabled } as Record<string, unknown>)
          : null,
    });

    if (result.status === 'ignored') {
      await interaction.editReply({ content: '現在Herta AIを利用できません。' });
    } else if (result.status === 'handled') {
      context.logger.info(
        { guildId: context.guildId, intent: result.intent, result: 'handled', source: 'ai.ask' },
        'AI Discord requestを処理しました',
      );
    }
  } catch (error) {
    context.logger.warn(
      {
        guildId: context.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        result: 'delivery_failed',
        source: 'ai.ask',
      },
      'AI Discord deliveryに失敗しました',
    );
    await interaction
      .editReply({ content: 'AIの応答中にエラーが発生しました。' })
      .catch(() => undefined);
  }
}

/**
 * Existing conversation/artifact handlers intentionally keep Herta user-mention semantics as
 * their internal contract. After the configured Role mention has been server-side verified, adapt
 * only that trusted trigger token into the same internal form. Arbitrary Role text never reaches
 * this adapter because candidate verification requires both Discord mention metadata and `<@&id>`.
 */
function normalizeConfiguredRoleTriggerMessage(
  message: AiArtifactDiscordMessage,
  botUserId: string,
  triggerRoleId: string | null,
): AiArtifactDiscordMessage {
  if (
    !triggerRoleId ||
    !message.mentions.roles?.has(triggerRoleId) ||
    !message.content.includes(`<@&${triggerRoleId}>`)
  ) {
    return message;
  }

  const content = message.content.replace(
    new RegExp(`<@&${triggerRoleId}>`, 'g'),
    `<@${botUserId}>`,
  );
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    content,
    webhookId: message.webhookId,
    author: message.author,
    member: message.member,
    mentions: {
      users: {
        has: (userId: string) => userId === botUserId || message.mentions.users.has(userId),
      },
      roles: message.mentions.roles,
    },
    reference: message.reference,
    fetchReference: message.fetchReference ? message.fetchReference.bind(message) : undefined,
    reply: message.reply.bind(message),
  };
}

function messageContentIntentEnabled(): boolean {
  const value = process.env['DISCORD_ENABLE_MESSAGE_CONTENT_INTENT']?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

async function getSharedRuntime(
  context: AiPluginRuntimeContext,
): Promise<AiPluginSharedRuntime | null> {
  if (!sharedRuntimePromise) {
    const pending = createSharedRuntime(context).catch((error: unknown) => {
      getSharedRuntimeLogger().warn(
        {
          initializingGuildId: context.guildId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'AI runtimeの初期化に失敗しました',
      );
      return null;
    });
    sharedRuntimePromise = pending;
    const runtime = await pending;
    if (!runtime && sharedRuntimePromise === pending) sharedRuntimePromise = undefined;
    return runtime;
  }
  return sharedRuntimePromise;
}

async function recordAiUsageAnalytics(
  prisma: PrismaClient,
  logger: Logger,
  event: AiTelemetryEvent,
): Promise<void> {
  try {
    await recordAiGenerationEvent(prisma, {
      guildId: event.guildId,
      provider: event.provider,
      model: event.model,
      modelProfile: event.modelProfile,
      feature: event.feature,
      resultCategory: event.resultCategory,
      errorCategory: event.errorCategory,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      totalTokens: event.totalTokens,
      estimatedCostUsd: event.estimatedCost,
      durationMs: event.latencyMs,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        provider: event.provider,
        feature: event.feature,
      },
      'AI利用状況の記録に失敗しました',
    );
  }
}

async function createSharedRuntime(
  context: AiPluginRuntimeContext,
): Promise<AiPluginSharedRuntime | null> {
  const logger = getSharedRuntimeLogger();
  const redisUrl = process.env['REDIS_URL']?.trim();
  if (!redisUrl) {
    logger.warn(
      { initializingGuildId: context.guildId },
      'REDIS_URLが未設定のためAI runtimeを有効化できません',
    );
    return null;
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
  redis.on('error', () => {
    logger.warn('AI guard用Redis接続でエラーが発生しました');
  });

  const bootstrap = await createAiFoundationRuntime({
    prisma: context.prisma,
    redis,
    env: process.env,
    telemetry: (event) => {
      // The Foundation runtime is process-wide. Never use a Guild-scoped Plugin logger here,
      // otherwise the first Guild that initializes the runtime would be attached to all events.
      logger.info(event, 'AI Foundation telemetry');
      void recordAiUsageAnalytics(context.prisma, logger, event);
    },
  });
  if (!bootstrap.service) {
    redis.disconnect();
    logger.info(
      { status: bootstrap.status, credentialSource: bootstrap.credentialSource },
      'AI runtimeはserver-side gateにより無効です',
    );
    return null;
  }
  if (enabledGuilds.size === 0) {
    redis.disconnect();
    return null;
  }

  let artifactConfig;
  try {
    artifactConfig = resolveAiArtifactConfig(process.env);
  } catch (error) {
    redis.disconnect();
    throw error;
  }
  if (enabledGuilds.size === 0) {
    redis.disconnect();
    return null;
  }

  sharedRedis = redis;
  logger.info(
    {
      status: bootstrap.status,
      credentialSource: bootstrap.credentialSource,
      artifactMaxBytes: artifactConfig.maxBytes,
      artifactMaxFiles: artifactConfig.maxFiles,
      executionAvailable: Boolean(bootstrap.executionService),
      imageGenerationAvailable: Boolean(bootstrap.imageGenerationService),
    },
    'AI runtimeを初期化しました',
  );

  const createArtifactRuntime = (
    generationService: AiRuntimeGenerationService,
    directReplyContext: string | null = null,
    featureOverrides: AiArtifactFeatureOverrides = {},
  ) =>
    new AiArtifactRuntime({
      generationService,
      executionService:
        featureOverrides.codeExecutionEnabled === false
          ? undefined
          : withAiDirectReplyCodeExecutionContext(
              bootstrap.executionService ?? undefined,
              directReplyContext,
            ),
      imageGenerationService:
        featureOverrides.imageGenerationEnabled === false
          ? undefined
          : withAiDirectReplyImageGenerationContext(
              bootstrap.imageGenerationService ?? undefined,
              directReplyContext,
            ),
      artifactConfig,
      telemetry: (event) => {
        // Artifact runtime is shared for the same reason as Foundation runtime telemetry.
        logger.info(event, 'AI Artifact telemetry');
      },
    });
  const artifactRuntime = createArtifactRuntime(bootstrap.service);

  return {
    artifactRuntime,
    createArtifactRuntime,
    generationService: bootstrap.service,
  };
}

function getSharedRuntimeLogger(): Logger {
  sharedRuntimeLogger ??= createLogger({
    name: 'herta-bot-ai-runtime',
    level: process.env['BOT_LOG_LEVEL'],
  });
  return sharedRuntimeLogger;
}

async function closeSharedRuntime(): Promise<void> {
  sharedRuntimePromise = undefined;
  const redis = sharedRedis;
  sharedRedis = undefined;
  if (redis) await redis.quit().catch(() => redis.disconnect());
}
