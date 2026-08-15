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
  it('正しいPresence更新イベントを適用する', () => {
    const onPresenceChanged = vi.fn();
    const subscriber = new BotPresenceEventSubscriber(onPresenceChanged, createLogger());

    subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:00.000Z',
        config: {
          status: 'idle',
          activityType: 'watching',
          activityText: 'Herta Studio',
        },
      }),
    );

    expect(onPresenceChanged).toHaveBeenCalledOnce();
    expect(onPresenceChanged).toHaveBeenCalledWith({
      status: 'idle',
      activityType: 'watching',
      activityText: 'Herta Studio',
    });
  });

  it('不正イベントと古いイベントを適用しない', () => {
    const logger = createLogger();
    const onPresenceChanged = vi.fn();
    const subscriber = new BotPresenceEventSubscriber(onPresenceChanged, logger);

    subscriber.handleMessage('{');
    subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:01.000Z',
        config: { status: 'online', activityType: 'playing', activityText: 'Latest' },
      }),
    );
    subscriber.handleMessage(
      JSON.stringify({
        version: 1,
        occurredAt: '2026-08-15T13:00:00.000Z',
        config: { status: 'dnd', activityType: 'playing', activityText: 'Old' },
      }),
    );

    expect(onPresenceChanged).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
