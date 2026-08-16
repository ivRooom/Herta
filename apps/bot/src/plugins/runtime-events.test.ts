import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@herta/logger';
import { createPluginRuntimeEvent } from '@herta/shared';
import { PluginRuntimeEventSubscriber } from './runtime-events.js';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PluginRuntimeEventSubscriber', () => {
  it('同一イベントを重複処理せず対象Guildだけを再同期する', async () => {
    vi.useFakeTimers();
    const synced: string[] = [];
    const subscriber = new PluginRuntimeEventSubscriber(
      async (guildId) => {
        synced.push(guildId);
      },
      createLogger(),
      10,
    );
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'config_updated',
      occurredAt: new Date('2026-07-14T00:00:00.000Z'),
    });

    subscriber.handleMessage(JSON.stringify(event));
    subscriber.handleMessage(JSON.stringify(event));
    await vi.runAllTimersAsync();

    expect(synced).toEqual(['guild-a']);
  });

  it('古いversionと時刻のイベントを無視する', async () => {
    vi.useFakeTimers();
    const synced: string[] = [];
    const subscriber = new PluginRuntimeEventSubscriber(
      async (guildId) => {
        synced.push(guildId);
      },
      createLogger(),
      10,
    );
    const newest = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 3,
      eventType: 'enabled',
      occurredAt: new Date('2026-07-14T00:01:00.000Z'),
    });
    const stale = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'disabled',
      occurredAt: new Date('2026-07-14T00:02:00.000Z'),
    });

    subscriber.handleMessage(JSON.stringify(newest));
    subscriber.handleMessage(JSON.stringify(stale));
    await vi.runAllTimersAsync();

    expect(synced).toEqual(['guild-a']);
  });

  it('Guildごとに独立して同期し失敗したGuildだけ最大3回再試行する', async () => {
    vi.useFakeTimers();
    const synced: string[] = [];
    const subscriber = new PluginRuntimeEventSubscriber(
      async (guildId) => {
        synced.push(guildId);
        if (guildId === 'guild-a') throw new Error('sync failed');
      },
      createLogger(),
      10,
    );

    for (const guildId of ['guild-a', 'guild-b']) {
      subscriber.handleMessage(
        JSON.stringify(
          createPluginRuntimeEvent({
            guildId,
            pluginId: 'quote',
            configVersion: 1,
            eventType: 'enabled',
          }),
        ),
      );
    }
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(synced.filter((guildId) => guildId === 'guild-a')).toHaveLength(3);
    expect(synced.filter((guildId) => guildId === 'guild-b')).toHaveLength(1);
  });

  it('一時的な同期失敗から再試行で復旧する', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const logger = createLogger();
    const subscriber = new PluginRuntimeEventSubscriber(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('temporary failure');
      },
      logger,
      10,
    );
    subscriber.handleMessage(
      JSON.stringify(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'mini-games',
          configVersion: 4,
          eventType: 'enabled',
        }),
      ),
    );

    await vi.runAllTimersAsync();

    expect(attempts).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(
      { guildId: 'guild-a', attempt: 2 },
      'Plugin Runtime Guild再同期の再試行に成功しました',
    );
  });

  it('不正なpayloadを破棄する', async () => {
    vi.useFakeTimers();
    const onGuildChanged = vi.fn(async () => undefined);
    const subscriber = new PluginRuntimeEventSubscriber(onGuildChanged, createLogger(), 10);

    subscriber.handleMessage('{invalid');
    await vi.runAllTimersAsync();

    expect(onGuildChanged).not.toHaveBeenCalled();
  });
});
