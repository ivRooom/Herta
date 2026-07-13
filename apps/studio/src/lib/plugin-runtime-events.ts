import Redis from 'ioredis';
import {
  PLUGIN_RUNTIME_EVENT_CHANNEL,
  createPluginRuntimeEvent,
  type PluginRuntimeEventType,
} from '@herta/shared';

let publisher: Redis | undefined;

function getPublisher(): Redis | undefined {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) return undefined;

  publisher ??= new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  return publisher;
}

export async function publishPluginRuntimeEvent(input: {
  guildId: string;
  pluginId: string;
  configVersion: number;
  eventType: PluginRuntimeEventType;
}): Promise<boolean> {
  const redis = getPublisher();
  if (!redis) return false;

  try {
    if (redis.status === 'wait') await redis.connect();
    const event = createPluginRuntimeEvent(input);
    await redis.publish(PLUGIN_RUNTIME_EVENT_CHANNEL, JSON.stringify(event));
    return true;
  } catch (error) {
    console.error('Plugin Runtime更新イベントの発行に失敗しました', {
      guildId: input.guildId,
      pluginId: input.pluginId,
      eventType: input.eventType,
      error,
    });
    return false;
  }
}
