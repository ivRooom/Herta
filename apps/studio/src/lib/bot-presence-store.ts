import {
  BOT_PRESENCE_EVENT_CHANNEL,
  DEFAULT_BOT_PRESENCE_CONFIG,
  createBotPresenceUpdateEvent,
  normalizeBotPresenceConfig,
  type BotPresenceConfig,
} from '@herta/shared';
import { prisma } from '@/lib/db';
import { redisCommand } from '@/lib/redis-command';

export interface BotPresenceState {
  config: BotPresenceConfig;
  persistenceAvailable: boolean;
}

export async function getStoredBotPresence(): Promise<BotPresenceState> {
  try {
    const setting = await prisma.botPresenceSetting.findUnique({
      where: { id: 'default' },
      select: {
        status: true,
        activityType: true,
        activityText: true,
      },
    });
    return {
      config: setting ? normalizeBotPresenceConfig(setting) : { ...DEFAULT_BOT_PRESENCE_CONFIG },
      persistenceAvailable: true,
    };
  } catch (error) {
    console.error('Bot Presence設定のDB読み込みに失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { config: { ...DEFAULT_BOT_PRESENCE_CONFIG }, persistenceAvailable: false };
  }
}

export async function saveBotPresence(
  config: BotPresenceConfig,
  updatedBy: string,
): Promise<{
  persisted: boolean;
  subscriberCount: number;
}> {
  await prisma.botPresenceSetting.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      status: config.status,
      activityType: config.activityType,
      activityText: config.activityText,
      updatedBy,
    },
    update: {
      status: config.status,
      activityType: config.activityType,
      activityText: config.activityText,
      updatedBy,
    },
  });

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return { persisted: true, subscriberCount: 0 };

  try {
    const event = JSON.stringify(createBotPresenceUpdateEvent(config));
    const publishResult = await redisCommand(
      redisUrl,
      'PUBLISH',
      BOT_PRESENCE_EVENT_CHANNEL,
      event,
    );
    return {
      persisted: true,
      subscriberCount: typeof publishResult === 'number' ? Math.max(0, publishResult) : 0,
    };
  } catch (error) {
    console.error('Bot Presence更新イベントの発行に失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { persisted: true, subscriberCount: 0 };
  }
}
