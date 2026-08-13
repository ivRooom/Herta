import { Redis } from 'ioredis';
import type { Logger } from '@herta/logger';
import {
  XP_ROLE_RECONCILIATION_EVENT_CHANNEL,
  parseXpRoleReconciliationEvent,
} from '@herta/shared';

export class XpRoleReconciliationSubscriber {
  private redis?: Redis;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly seenEventIds = new Set<string>();

  constructor(
    private readonly reconcile: (guildId: string, userId: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly debounceMs = 150,
  ) {}

  async start(redisUrl: string): Promise<void> {
    if (this.redis) return;
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis = redis;

    redis.on('ready', () => this.logger.info('XP報酬Role再同期イベントのRedis購読を開始しました'));
    redis.on('reconnecting', () =>
      this.logger.warn('XP報酬Role再同期イベントのRedis再接続を試行しています'),
    );
    redis.on('error', (error: unknown) =>
      this.logger.error(
        { err: error },
        'XP報酬Role再同期イベントのRedis接続でエラーが発生しました',
      ),
    );
    redis.on('message', (channel: string, payload: string) => {
      if (channel === XP_ROLE_RECONCILIATION_EVENT_CHANNEL) this.handleMessage(payload);
    });

    await redis.connect();
    await redis.subscribe(XP_ROLE_RECONCILIATION_EVENT_CHANNEL);
  }

  handleMessage(payload: string): void {
    const event = parseXpRoleReconciliationEvent(payload);
    if (!event) {
      this.logger.warn('不正なXP報酬Role再同期イベントを破棄しました');
      return;
    }
    if (this.seenEventIds.has(event.eventId)) return;
    this.seenEventIds.add(event.eventId);
    if (this.seenEventIds.size > 2_000) {
      const oldest = this.seenEventIds.values().next().value as string | undefined;
      if (oldest) this.seenEventIds.delete(oldest);
    }

    const key = `${event.guildId}:${event.userId}`;
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.enqueue(key, event.guildId, event.userId);
      }, this.debounceMs),
    );
  }

  private enqueue(key: string, guildId: string, userId: string): void {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.reconcile(guildId, userId))
      .catch((error) => {
        this.logger.error(
          { err: error, guildId, userId },
          'XP報酬Role再同期イベントの処理に失敗しました',
        );
      })
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      });
    this.queues.set(key, next);
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled(this.queues.values());
    this.queues.clear();

    const redis = this.redis;
    this.redis = undefined;
    if (!redis) return;
    await redis.unsubscribe(XP_ROLE_RECONCILIATION_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }
}
