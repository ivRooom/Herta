import { Redis } from 'ioredis';
import type { Logger } from '@herta/logger';
import {
  XP_ROLE_SWEEP_EVENT_CHANNEL,
  parseXpRoleSweepEvent,
  type XpRoleSweepEvent,
} from '@herta/shared';

export class XpRoleSweepSubscriber {
  private redis?: Redis;
  private readonly seenEventIds = new Set<string>();
  private readonly guildQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly onSweep: (event: XpRoleSweepEvent) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  async start(redisUrl: string): Promise<void> {
    if (this.redis) return;

    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis = redis;

    redis.on('ready', () =>
      this.logger.info('XP報酬Role一括修復イベントのRedis購読を開始しました'),
    );
    redis.on('reconnecting', () =>
      this.logger.warn('XP報酬Role一括修復イベントのRedis再接続を試行しています'),
    );
    redis.on('error', (error: unknown) =>
      this.logger.error(
        { err: error },
        'XP報酬Role一括修復イベントのRedis接続でエラーが発生しました',
      ),
    );
    redis.on('message', (channel: string, payload: string) => {
      if (channel === XP_ROLE_SWEEP_EVENT_CHANNEL) this.handleMessage(payload);
    });

    await redis.connect();
    await redis.subscribe(XP_ROLE_SWEEP_EVENT_CHANNEL);
  }

  handleMessage(payload: string): void {
    const event = parseXpRoleSweepEvent(payload);
    if (!event) {
      this.logger.warn('不正なXP報酬Role一括修復イベントを破棄しました');
      return;
    }
    if (this.seenEventIds.has(event.eventId)) return;

    this.seenEventIds.add(event.eventId);
    if (this.seenEventIds.size > 2_000) {
      const oldest = this.seenEventIds.values().next().value as string | undefined;
      if (oldest) this.seenEventIds.delete(oldest);
    }

    const previous = this.guildQueues.get(event.guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.onSweep(event))
      .catch((error) => {
        this.logger.error(
          { err: error, guildId: event.guildId, requestId: event.requestId },
          'XP報酬Role一括修復に失敗しました',
        );
      })
      .finally(() => {
        if (this.guildQueues.get(event.guildId) === next) this.guildQueues.delete(event.guildId);
      });
    this.guildQueues.set(event.guildId, next);
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.guildQueues.values());
    this.guildQueues.clear();

    const redis = this.redis;
    this.redis = undefined;
    if (!redis) return;
    await redis.unsubscribe(XP_ROLE_SWEEP_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }
}
