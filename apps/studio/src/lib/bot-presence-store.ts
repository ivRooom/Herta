import {
  BOT_PRESENCE_CONFIG_KEY,
  BOT_PRESENCE_EVENT_CHANNEL,
  DEFAULT_BOT_PRESENCE_CONFIG,
  createBotPresenceUpdateEvent,
  normalizeBotPresenceConfig,
  type BotPresenceConfig,
} from '@herta/shared';
import { redisCommand } from '@/lib/redis-command';

export interface BotPresenceState {
  config: BotPresenceConfig;
  persistenceAvailable: boolean;
}

export async function getStoredBotPresence(): Promise<BotPresenceState> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    return { config: { ...DEFAULT_BOT_PRESENCE_CONFIG }, persistenceAvailable: false };
  }

  try {
    const value = await redisCommand(redisUrl, 'GET', BOT_PRESENCE_CONFIG_KEY);
    if (typeof value !== 'string') {
      return { config: { ...DEFAULT_BOT_PRESENCE_CONFIG }, persistenceAvailable: true };
    }
    return {
      config: normalizeBotPresenceConfig(JSON.parse(value) as unknown),
      persistenceAvailable: true,
    };
  } catch (error) {
    console.error('Bot Presence設定のRedis読み込みに失敗しました', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { config: { ...DEFAULT_BOT_PRESENCE_CONFIG }, persistenceAvailable: false };
  }
}

export async function saveBotPresence(config: BotPresenceConfig): Promise<{
  persisted: boolean;
  subscriberCount: number;
}> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return { persisted: false, subscriberCount: 0 };

  const serialized = JSON.stringify(config);
  const event = JSON.stringify(createBotPresenceUpdateEvent(config));

  await redisCommand(redisUrl, 'SET', BOT_PRESENCE_CONFIG_KEY, serialized);
  const publishResult = await redisCommand(redisUrl, 'PUBLISH', BOT_PRESENCE_EVENT_CHANNEL, event);
  return {
    persisted: true,
    subscriberCount: typeof publishResult === 'number' ? Math.max(0, publishResult) : 0,
  };
}
