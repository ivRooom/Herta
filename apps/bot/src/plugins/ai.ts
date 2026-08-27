import type { PrismaClient } from '@herta/db';
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
  handleAiArtifactMessage,
  isAiArtifactMessageCandidate,
  type AiArtifactDiscordMessage,
} from '../ai/artifact-message-handler.js';
import { createAiFoundationRuntime } from '../ai/factory.js';

export interface AiPluginConfig {
  enabled: boolean;
}

type AiPluginRuntimeContext = PluginRuntimeContext<AiPluginConfig, Client, PrismaClient>;

let sharedRuntimePromise: Promise<AiArtifactRuntime | null> | undefined;
let sharedRedis: Redis | undefined;
const enabledGuilds = new Set<string>();

export const aiPlugin = definePlugin<AiPluginConfig, Client, PrismaClient>({
  manifest: aiManifest,
  async onEnable(context) {
    enabledGuilds.add(context.guildId);
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
  if (
    !isAiArtifactMessageCandidate(message, botUserId) ||
    message.guildId !== context.guildId
  ) {
    return;
  }

  try {
    const runtime = await getSharedRuntime(context);
    const result = await handleAiArtifactMessage(message, {
      runtime,
      botUserId,
      getAiPluginConfig: async (guildId) =>
        guildId === context.guildId
          ? ({ enabled: context.config.enabled } as Record<string, unknown>)
          : null,
    });

    if (result.status === 'handled') {
      context.logger.info(
        { guildId: context.guildId, intent: result.intent, result: 'handled' },
        'AI Artifact requestを処理しました',
      );
    } else if (result.status === 'failed') {
      context.logger.warn(
        { guildId: context.guildId, category: result.category, result: 'failed' },
        'AI Artifact requestを安全に処理できませんでした',
      );
    }
  } catch (error) {
    // Discord SDK errors can carry request payload details. Never pass the raw error object to
    // structured logging on the artifact path because attachment bytes are sensitive content.
    context.logger.warn(
      {
        guildId: context.guildId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        result: 'delivery_failed',
      },
      'AI Artifact Discord deliveryに失敗しました',
    );
  }
}

async function getSharedRuntime(
  context: AiPluginRuntimeContext,
): Promise<AiArtifactRuntime | null> {
  if (!sharedRuntimePromise) {
    const pending = createSharedRuntime(context).catch((error: unknown) => {
      context.logger.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'AI Artifact runtimeの初期化に失敗しました',
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
): Promise<AiArtifactRuntime | null> {
  const redisUrl = process.env['REDIS_URL']?.trim();
  if (!redisUrl) {
    context.logger.warn('REDIS_URLが未設定のためAI Artifact runtimeを有効化できません');
    return null;
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
  redis.on('error', () => {
    context.logger.warn('AI guard用Redis接続でエラーが発生しました');
  });

  const bootstrap = await createAiFoundationRuntime({
    prisma: context.prisma,
    redis,
    env: process.env,
  });
  if (!bootstrap.service) {
    redis.disconnect();
    context.logger.info(
      { status: bootstrap.status, credentialSource: bootstrap.credentialSource },
      'AI Artifact runtimeはserver-side gateにより無効です',
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
  context.logger.info(
    {
      status: bootstrap.status,
      credentialSource: bootstrap.credentialSource,
      artifactMaxBytes: artifactConfig.maxBytes,
      artifactMaxFiles: artifactConfig.maxFiles,
    },
    'AI Artifact runtimeを初期化しました',
  );
  return new AiArtifactRuntime({
    generationService: bootstrap.service,
    artifactConfig,
    telemetry: (event) => {
      context.logger.info(event, 'AI Artifact telemetry');
    },
  });
}

async function closeSharedRuntime(): Promise<void> {
  sharedRuntimePromise = undefined;
  const redis = sharedRedis;
  sharedRedis = undefined;
  if (redis) await redis.quit().catch(() => redis.disconnect());
}
