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
  it('正しいPresence更新イベントを受信するとDB正本を適用する', async () => {
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi.fn().mockResolvedValue({
      status: 'idle',
      activityType: 'watching',
      activityText: 'Latest from DB',
    });
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
          activityText: 'Potentially stale event payload',
        },
      }),
    );

    expect(loadCurrentPresence).toHaveBeenCalledOnce();
    expect(onPresenceChanged).toHaveBeenCalledWith({
      status: 'idle',
      activityType: 'watching',
      activityText: 'Latest from DB',
    });
  });

  it('publisherのtimestamp順序に関係なく有効な通知ごとにDB正本を再読込する', async () => {
    const onPresenceChanged = vi.fn();
    const loadCurrentPresence = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'online',
        activityType: 'playing',
        activityText: 'First DB state',
      })
      .mockResolvedValueOnce({
        status: 'dnd',
        activityType: 'competing',
        activityText: 'Latest DB state',
      });
    const subscriber = new BotPresenceEventSubscriber(
      onPresenceChanged,
      createLogger(),
      loadCurrentPresence,
    );

    await subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:01.000Z',
        config: { status: 'online', activityType: 'playing', activityText: 'Newer clock' },
      }),
    );
    await subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T12:59:59.000Z',
        config: { status: 'idle', activityType: 'watching', activityText: 'Older clock' },
      }),
    );

    expect(loadCurrentPresence).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenCalledTimes(2);
    expect(onPresenceChanged).toHaveBeenLastCalledWith({
      status: 'dnd',
      activityType: 'competing',
      activityText: 'Latest DB state',
    });
  });

  it('不正イベントはDB正本を読み込まず破棄する', async () => {
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
