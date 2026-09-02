import type { PrismaClient } from '@herta/db';
import { createLogger, type Logger } from '@herta/logger';
import { aiManifest } from '@herta/plugin-catalog';
import { resolveAiArtifactConfig } from '@herta/plugin-catalog/ai-artifact';
import {
  definePlugin,
  type PluginEventHandler,
  type PluginRuntimeContext,
} from '@herta/plugin-sdk';
import type { Client } from 'discord.js';
import { Redis } from 'ioredis';
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
import type { AiRuntimeGenerationService } from '../ai/runtime-service.js';
import { startAiTypingIndicator } from '../ai/typing-indicator.js';

export interface AiPluginConfig {
  enabled: boolean;
  triggerRoleId?: string | null;
}

type AiPluginRuntimeContext = PluginRuntimeContext<AiPluginConfig, Client, PrismaClient>;

interface AiPluginSharedRuntime {
  artifactRuntime: AiArtifactRuntime;
  createArtifactRuntime(
    generationService: AiRuntimeGenerationService,
    directReplyContext?: string | null,
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
    if (enabledGuilds.size === 0) await closeSharedRuntime();
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
  if (context.config.enabled !== true) return;

  const botUserId = context.client.user?.id ?? null;
  if (!message || !botUserId || message.guildId !== context.guildId) return;

  const triggerRoleId = normalizeAiTriggerRoleId(context.config.triggerRoleId);
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
    const generationService = runtime?.generationService
      ? withAiDirectReplyContext(runtime.generationService, directReplyContext)
      : null;
    let artifactRuntime = runtime?.artifactRuntime ?? null;
    if (runtime && generationService && directReplyContext) {
      artifactRuntime = runtime.createArtifactRuntime(generationService, directReplyContext);
    }
    const result = await handleAiConversationMessage(handlerMessage, {
      runtime: artifactRuntime,
      generationService,
      botUserId,
      getAiPluginConfig: async (guildId) =>
        guildId === context.guildId
          ? ({ enabled: context.config.enabled } as Record<string, unknown>)
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
  ) =>
    new AiArtifactRuntime({
      generationService,
      executionService: withAiDirectReplyCodeExecutionContext(
        bootstrap.executionService ?? undefined,
        directReplyContext,
      ),
      imageGenerationService: withAiDirectReplyImageGenerationContext(
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
