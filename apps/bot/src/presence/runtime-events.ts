import { getPrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  BOT_PRESENCE_EVENT_CHANNEL,
  parseBotPresenceUpdateEvent,
  type BotPresenceConfig,
} from '@herta/shared';
import { Redis } from 'ioredis';
import { loadStoredBotPresence } from './store.js';

type BotPresenceLoader = () => Promise<BotPresenceConfig>;

export class BotPresenceEventSubscriber {
  private redis?: Redis;
  private lastOccurredAt = 0;

  constructor(
    private readonly onPresenceChanged: (config: BotPresenceConfig) => void,
    private readonly logger: Logger,
    private readonly loadCurrentPresence: BotPresenceLoader = () =>
      loadStoredBotPresence(getPrismaClient()),
  ) {}

  async start(redisUrl: string): Promise<void> {
    if (this.redis) return;

    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis = redis;

    redis.on('ready', () => this.logger.info('Bot PresenceイベントのRedis購読を開始しました'));
    redis.on('reconnecting', () =>
      this.logger.warn('Bot PresenceイベントのRedis再接続を試行しています'),
    );
    redis.on('error', (error: unknown) =>
      this.logger.error({ err: error }, 'Bot PresenceイベントのRedis接続でエラーが発生しました'),
    );
    redis.on('message', (channel: string, payload: string) => {
      if (channel !== BOT_PRESENCE_EVENT_CHANNEL) return;
      this.handleMessage(payload);
    });

    try {
      await redis.connect();
      await redis.subscribe(BOT_PRESENCE_EVENT_CHANNEL);
      await this.refreshStoredPresence();
    } catch (error) {
      this.redis = undefined;
      redis.disconnect();
      throw error;
    }
  }

  async refreshStoredPresence(): Promise<void> {
    try {
      this.onPresenceChanged(await this.loadCurrentPresence());
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis購読後のBot Presence設定再読み込みに失敗しました');
    }
  }

  handleMessage(payload: string): void {
    const event = parseBotPresenceUpdateEvent(payload);
    if (!event) {
      this.logger.warn('不正なBot Presenceイベントを破棄しました');
      return;
    }

    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < this.lastOccurredAt) return;
    this.lastOccurredAt = occurredAt;

    try {
      this.onPresenceChanged(event.config);
    } catch (error) {
      this.logger.error({ err: error }, 'Bot Presenceイベントの適用に失敗しました');
    }
  }

  async stop(): Promise<void> {
    const redis = this.redis;
    this.redis = undefined;
    if (!redis) return;
    await redis.unsubscribe(BOT_PRESENCE_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }
}
