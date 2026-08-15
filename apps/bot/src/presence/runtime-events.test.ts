import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@herta/logger';
import { BotPresenceEventSubscriber } from './runtime-events.js';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('BotPresenceEventSubscriber', () => {
  it('正しいPresence更新通知でDB正本を再読み込みする', async () => {
    const storedConfig = {
      status: 'idle' as const,
      activityType: 'watching' as const,
      activityText: 'Herta Studio',
    };
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi.fn().mockResolvedValue(storedConfig);
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      createLogger(),
      loadCurrentPresence,
    );

    await subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:00.000Z',
        config: {
          status: 'online',
          activityType: 'playing',
          activityText: 'Publisher payload',
        },
      }),
    );

    expect(loadCurrentPresence).toHaveBeenCalledOnce();
    expect(onPresenceChanged).toHaveBeenCalledOnce();
    expect(onPresenceChanged).toHaveBeenCalledWith(storedConfig);
  });

  it('publisher時刻が前後しても通知ごとにDB正本を直列再読み込みする', async () => {
    const firstStoredConfig = {
      status: 'online' as const,
      activityType: 'playing' as const,
      activityText: 'First stored state',
    };
    const secondStoredConfig = {
      status: 'dnd' as const,
      activityType: 'competing' as const,
      activityText: 'Second stored state',
    };
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi
      .fn()
      .mockResolvedValueOnce(firstStoredConfig)
      .mockResolvedValueOnce(secondStoredConfig);
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      createLogger(),
      loadCurrentPresence,
    );

    const first = subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:01.000Z',
        config: { status: 'online', activityType: 'playing', activityText: 'Newer clock' },
      }),
    );
    const second = subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T12:59:59.000Z',
        config: { status: 'idle', activityType: 'watching', activityText: 'Older clock' },
      }),
    );

    await Promise.all([first, second]);

    expect(loadCurrentPresence).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenNthCalledWith(1, firstStoredConfig);
    expect(onPresenceChanged).toHaveBeenNthCalledWith(2, secondStoredConfig);
  });

  it('同一timestampの通知も欠落させない', async () => {
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'online',
        activityType: 'playing',
        activityText: 'First',
      })
      .mockResolvedValueOnce({
        status: 'idle',
        activityType: 'watching',
        activityText: 'Second',
      });
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      createLogger(),
      loadCurrentPresence,
    );
    const occurredAt = '2026-08-15T13:00:00.000Z';

    await Promise.all([
      subscriber.handleMessage(
        JSON.stringify({
          version: 1,
          occurredAt,
          config: { status: 'online', activityType: 'playing', activityText: 'First event' },
        }),
      ),
      subscriber.handleMessage(
        JSON.stringify({
          version: 1,
          occurredAt,
          config: { status: 'idle', activityType: 'watching', activityText: 'Second event' },
        }),
      ),
    ]);

    expect(loadCurrentPresence).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenCalledTimes(2);
  });

  it('不正イベントはDBを読まず適用しない', async () => {
    const logger = createLogger();
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi.fn();
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      logger,
      loadCurrentPresence,
    );

    await subscriber.handleMessage('{');

    expect(loadCurrentPresence).not.toHaveBeenCalled();
    expect(onPresenceChanged).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('Redis購読後にDB正本を再読み込みしてPresenceを同期する', async () => {
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi.fn().mockResolvedValue({
      status: 'dnd',
      activityType: 'competing',
      activityText: 'Latest from DB',
    });
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      createLogger(),
      loadCurrentPresence,
    );

    await subscriber.refreshStoredPresence();

    expect(loadCurrentPresence).toHaveBeenCalledOnce();
    expect(onPresenceChanged).toHaveBeenCalledWith({
      status: 'dnd',
      activityType: 'competing',
      activityText: 'Latest from DB',
    });
  });

  it('DB正本の再読み込み失敗は購読処理を落とさず警告に留める', async () => {
    const logger = createLogger();
    const onPresenceChanged = vi.fn();
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      logger,
      vi.fn().mockRejectedValue(new Error('database unavailable')),
    );

    await expect(subscriber.refreshStoredPresence()).resolves.toBeUndefined();
    expect(onPresenceChanged).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
