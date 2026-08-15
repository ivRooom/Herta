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
  private refreshQueue: Promise<void> = Promise.resolve();
  private subscriptionEstablished = false;

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

    redis.on('ready', () => {
      this.logger.info('Bot PresenceイベントのRedis購読を開始しました');
      if (this.subscriptionEstablished) {
        void this.enqueueStoredPresenceRefresh();
      }
    });
    redis.on('reconnecting', () =>
      this.logger.warn('Bot PresenceイベントのRedis再接続を試行しています'),
    );
    redis.on('error', (error: unknown) =>
      this.logger.error({ err: error }, 'Bot PresenceイベントのRedis接続でエラーが発生しました'),
    );
    redis.on('message', (channel: string, payload: string) => {
      if (channel !== BOT_PRESENCE_EVENT_CHANNEL) return;
      void this.handleMessage(payload);
    });

    try {
      await redis.connect();
      await redis.subscribe(BOT_PRESENCE_EVENT_CHANNEL);
      this.subscriptionEstablished = true;
      await this.enqueueStoredPresenceRefresh();
    } catch (error) {
      this.redis = undefined;
      this.subscriptionEstablished = false;
      redis.disconnect();
      throw error;
    }
  }

  async refreshStoredPresence(): Promise<void> {
    try {
      this.onPresenceChanged(await this.loadCurrentPresence());
    } catch (error) {
      this.logger.warn({ err: error }, 'Bot Presence設定のDB再読み込みに失敗しました');
    }
  }

  async handleMessage(payload: string): Promise<void> {
    const event = parseBotPresenceUpdateEvent(payload);
    if (!event) {
      this.logger.warn('不正なBot Presenceイベントを破棄しました');
      return;
    }

    // Redisイベントは変更通知としてのみ扱う。publisherのwall-clockには依存せず、
    // DB正本の再読み込みを直列化して複数Studioインスタンス間でも最新設定へ収束させる。
    await this.enqueueStoredPresenceRefresh();
  }

  async stop(): Promise<void> {
    const redis = this.redis;
    this.redis = undefined;
    this.subscriptionEstablished = false;
    if (!redis) return;
    await redis.unsubscribe(BOT_PRESENCE_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }

  private enqueueStoredPresenceRefresh(): Promise<void> {
    const nextRefresh = this.refreshQueue.then(() => this.refreshStoredPresence());
    this.refreshQueue = nextRefresh;
    return nextRefresh;
  }
}
