import { Redis } from 'ioredis';
import type { Logger } from '@herta/logger';
import {
  PLUGIN_RUNTIME_EVENT_CHANNEL,
  parsePluginRuntimeEvent,
  type PluginRuntimeEvent,
} from '@herta/shared';

interface EventCursor {
  configVersion: number;
  occurredAt: number;
}

const MAX_SYNC_ATTEMPTS = 3;
const SYNC_RETRY_BASE_MS = 500;

export class PluginRuntimeEventSubscriber {
  private redis?: Redis;
  private readonly cursors = new Map<string, EventCursor>();
  private readonly seenEventIds = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly guildQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly onGuildChanged: (guildId: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly debounceMs = 250,
  ) {}

  async start(redisUrl: string): Promise<void> {
    if (this.redis) return;

    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.redis = redis;

    redis.on('ready', () => this.logger.info('Plugin RuntimeイベントのRedis購読を開始しました'));
    redis.on('reconnecting', () =>
      this.logger.warn('Plugin RuntimeイベントのRedis再接続を試行しています'),
    );
    redis.on('error', (error: unknown) =>
      this.logger.error({ err: error }, 'Plugin RuntimeイベントのRedis接続でエラーが発生しました'),
    );
    redis.on('message', (channel: string, payload: string) => {
      if (channel === PLUGIN_RUNTIME_EVENT_CHANNEL) this.handleMessage(payload);
    });

    await redis.connect();
    await redis.subscribe(PLUGIN_RUNTIME_EVENT_CHANNEL);
  }

  handleMessage(payload: string): void {
    const event = parsePluginRuntimeEvent(payload);
    if (!event) {
      this.logger.warn('不正なPlugin Runtimeイベントを破棄しました');
      return;
    }
    if (!this.acceptEvent(event)) return;

    const existing = this.timers.get(event.guildId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      event.guildId,
      setTimeout(() => {
        this.timers.delete(event.guildId);
        this.enqueueGuildSync(event.guildId);
      }, this.debounceMs),
    );
  }

  private acceptEvent(event: PluginRuntimeEvent): boolean {
    if (this.seenEventIds.has(event.eventId)) return false;
    this.seenEventIds.add(event.eventId);
    if (this.seenEventIds.size > 2_000) {
      const oldest = this.seenEventIds.values().next().value as string | undefined;
      if (oldest) this.seenEventIds.delete(oldest);
    }

    const key = `${event.guildId}:${event.pluginId}`;
    const occurredAt = Date.parse(event.occurredAt);
    const cursor = this.cursors.get(key);
    if (
      cursor &&
      (event.configVersion < cursor.configVersion ||
        (event.configVersion === cursor.configVersion && occurredAt <= cursor.occurredAt))
    ) {
      this.logger.debug(
        { guildId: event.guildId, pluginId: event.pluginId, configVersion: event.configVersion },
        '古いPlugin Runtimeイベントを無視しました',
      );
      return false;
    }

    this.cursors.set(key, { configVersion: event.configVersion, occurredAt });
    return true;
  }

  private enqueueGuildSync(guildId: string): void {
    const previous = this.guildQueues.get(guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.syncGuildWithRetry(guildId))
      .finally(() => {
        if (this.guildQueues.get(guildId) === next) this.guildQueues.delete(guildId);
      });
    this.guildQueues.set(guildId, next);
  }

  private async syncGuildWithRetry(guildId: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      try {
        await this.onGuildChanged(guildId);
        if (attempt > 1) {
          this.logger.info(
            { guildId, attempt },
            'Plugin Runtime Guild再同期の再試行に成功しました',
          );
        }
        return;
      } catch (error) {
        if (attempt === MAX_SYNC_ATTEMPTS) {
          this.logger.error(
            { err: error, guildId, attempt },
            'Plugin RuntimeイベントによるGuild再同期に失敗しました',
          );
          return;
        }
        this.logger.warn(
          { err: error, guildId, attempt },
          'Plugin Runtime Guild再同期に失敗したため再試行します',
        );
        await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_BASE_MS * attempt));
      }
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled(this.guildQueues.values());
    this.guildQueues.clear();

    const redis = this.redis;
    this.redis = undefined;
    if (!redis) return;
    await redis.unsubscribe(PLUGIN_RUNTIME_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }
}
