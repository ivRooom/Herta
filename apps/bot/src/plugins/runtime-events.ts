import { Redis } from 'ioredis';
import { getPrismaClient } from '@herta/db';
import type { Logger } from '@herta/logger';
import {
  PLUGIN_RUNTIME_EVENT_CHANNEL,
  parsePluginRuntimeEvent,
  type PluginRuntimeEvent,
} from '@herta/shared';
import { defaultPluginRuntimeState } from './runtime-state.js';

interface EventCursor {
  configVersion: number;
  occurredAt: number;
}

export type PluginRuntimeSyncOutcome = 'applied' | 'apply_failed';
export type PluginRuntimeSyncReporter = (
  events: readonly PluginRuntimeEvent[],
  outcome: PluginRuntimeSyncOutcome,
  attempts: number,
) => Promise<void>;
export type PluginRuntimeApplyVerifier = (event: PluginRuntimeEvent) => boolean;

const MAX_SYNC_ATTEMPTS = 3;
const SYNC_RETRY_BASE_MS = 500;
const RUNTIME_STATE_NOT_APPLIED = 'PluginRuntimeStateNotApplied';

async function recordPluginRuntimeSyncOutcome(
  events: readonly PluginRuntimeEvent[],
  outcome: PluginRuntimeSyncOutcome,
  attempts: number,
): Promise<void> {
  if (!process.env['DATABASE_URL'] || events.length === 0) return;
  const prisma = getPrismaClient();
  await prisma.$transaction(
    events.map((event) =>
      prisma.auditLog.create({
        data: {
          guildId: event.guildId,
          actorId: 'herta-bot',
          actorType: 'service',
          event:
            outcome === 'applied'
              ? 'plugin.runtime_apply_succeeded'
              : 'plugin.runtime_apply_failed',
          targetType: 'plugin',
          targetId: event.pluginId,
          severity: outcome === 'applied' ? 'info' : 'warning',
          metadata: {
            operationSource: 'bot-runtime',
            eventId: event.eventId,
            eventType: event.eventType,
            configVersion: event.configVersion,
            attempts,
          },
        },
      }),
    ),
  );
}

export class PluginRuntimeEventSubscriber {
  private redis?: Redis;
  private readonly cursors = new Map<string, EventCursor>();
  private readonly seenEventIds = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly guildQueues = new Map<string, Promise<void>>();
  private readonly pendingEvents = new Map<string, Map<string, PluginRuntimeEvent>>();

  constructor(
    private readonly onGuildChanged: (guildId: string) => Promise<void>,
    private readonly logger: Logger,
    private readonly debounceMs = 250,
    private readonly reportSyncOutcome: PluginRuntimeSyncReporter = recordPluginRuntimeSyncOutcome,
    private readonly verifyApplied: PluginRuntimeApplyVerifier = (event) =>
      defaultPluginRuntimeState.isEventApplied(event),
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

    const pending = this.pendingEvents.get(event.guildId) ?? new Map<string, PluginRuntimeEvent>();
    pending.set(event.pluginId, event);
    this.pendingEvents.set(event.guildId, pending);

    const existing = this.timers.get(event.guildId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      event.guildId,
      setTimeout(() => {
        this.timers.delete(event.guildId);
        this.flushGuild(event.guildId);
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

  private flushGuild(guildId: string): void {
    const pending = this.pendingEvents.get(guildId);
    if (!pending || pending.size === 0) return;
    this.pendingEvents.delete(guildId);
    this.enqueueGuildSync(guildId, [...pending.values()]);
  }

  private enqueueGuildSync(guildId: string, events: readonly PluginRuntimeEvent[]): void {
    const previous = this.guildQueues.get(guildId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.syncGuildWithRetry(guildId, events))
      .finally(() => {
        if (this.guildQueues.get(guildId) === next) this.guildQueues.delete(guildId);
      });
    this.guildQueues.set(guildId, next);
  }

  private async reportOutcomeSafely(
    events: readonly PluginRuntimeEvent[],
    outcome: PluginRuntimeSyncOutcome,
    attempts: number,
  ): Promise<void> {
    try {
      await this.reportSyncOutcome(events, outcome, attempts);
    } catch (error) {
      this.logger.error(
        {
          errorName: resolveErrorName(error),
          guildId: events[0]?.guildId,
          eventIds: events.map((event) => event.eventId),
          outcome,
        },
        'Plugin Runtime反映結果の永続化に失敗しました',
      );
    }
  }

  private async syncGuildWithRetry(
    guildId: string,
    events: readonly PluginRuntimeEvent[],
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      try {
        await this.onGuildChanged(guildId);

        const appliedEvents: PluginRuntimeEvent[] = [];
        const unappliedEvents: PluginRuntimeEvent[] = [];
        for (const event of events) {
          if (this.verifyApplied(event)) appliedEvents.push(event);
          else unappliedEvents.push(event);
        }

        if (unappliedEvents.length === 0) {
          if (attempt > 1) {
            this.logger.info(
              { guildId, attempt },
              'Plugin Runtime Guild再同期の再試行に成功しました',
            );
          }
          await this.reportOutcomeSafely(appliedEvents, 'applied', attempt);
          return;
        }

        this.logger.warn(
          {
            guildId,
            attempt,
            plugins: unappliedEvents.map((event) => ({
              pluginId: event.pluginId,
              configVersion: event.configVersion,
              eventType: event.eventType,
            })),
          },
          'Plugin Runtime再同期後の適用状態を確認できませんでした',
        );

        if (attempt === MAX_SYNC_ATTEMPTS) {
          this.logger.error(
            { errorName: RUNTIME_STATE_NOT_APPLIED, guildId, attempt },
            'Plugin RuntimeイベントによるGuild再同期に失敗しました',
          );
          if (appliedEvents.length > 0) {
            await this.reportOutcomeSafely(appliedEvents, 'applied', attempt);
          }
          await this.reportOutcomeSafely(unappliedEvents, 'apply_failed', attempt);
          return;
        }

        this.logger.warn(
          { errorName: RUNTIME_STATE_NOT_APPLIED, guildId, attempt },
          'Plugin Runtime Guild再同期に失敗したため再試行します',
        );
      } catch (error) {
        if (attempt === MAX_SYNC_ATTEMPTS) {
          this.logger.error(
            { errorName: resolveErrorName(error), guildId, attempt },
            'Plugin RuntimeイベントによるGuild再同期に失敗しました',
          );
          await this.reportOutcomeSafely(events, 'apply_failed', attempt);
          return;
        }
        this.logger.warn(
          { errorName: resolveErrorName(error), guildId, attempt },
          'Plugin Runtime Guild再同期に失敗したため再試行します',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_BASE_MS * attempt));
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pendingEvents.clear();
    await Promise.allSettled(this.guildQueues.values());
    this.guildQueues.clear();

    const redis = this.redis;
    this.redis = undefined;
    if (!redis) return;
    await redis.unsubscribe(PLUGIN_RUNTIME_EVENT_CHANNEL).catch(() => undefined);
    await redis.quit().catch(() => redis.disconnect());
  }
}

function resolveErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : 'UnknownError';
}
