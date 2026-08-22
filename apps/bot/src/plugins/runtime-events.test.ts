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

const applied = () => true;

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
      vi.fn(async () => undefined),
      applied,
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
      vi.fn(async () => undefined),
      applied,
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
    const reportSyncOutcome = vi.fn(async () => undefined);
    const subscriber = new PluginRuntimeEventSubscriber(
      async (guildId) => {
        synced.push(guildId);
        if (guildId === 'guild-a') throw new Error('sync failed');
      },
      createLogger(),
      10,
      reportSyncOutcome,
      applied,
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
    expect(reportSyncOutcome).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ guildId: 'guild-a', pluginId: 'quote' })]),
      'apply_failed',
      3,
    );
    expect(reportSyncOutcome).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ guildId: 'guild-b', pluginId: 'quote' })]),
      'applied',
      1,
    );
  });

  it('一時的な同期失敗から再試行で復旧し適用済みACKを記録する', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const logger = createLogger();
    const reportSyncOutcome = vi.fn(async () => undefined);
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'mini-games',
      configVersion: 4,
      eventType: 'enabled',
    });
    const subscriber = new PluginRuntimeEventSubscriber(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('temporary failure');
      },
      logger,
      10,
      reportSyncOutcome,
      applied,
    );
    subscriber.handleMessage(JSON.stringify(event));

    await vi.runAllTimersAsync();

    expect(attempts).toBe(2);
    expect(reportSyncOutcome).toHaveBeenCalledWith([event], 'applied', 2);
    expect(logger.info).toHaveBeenCalledWith(
      { guildId: 'guild-a', attempt: 2 },
      'Plugin Runtime Guild再同期の再試行に成功しました',
    );
  });

  it('同一Guildの複数Pluginイベントを1回の同期でまとめてACKする', async () => {
    vi.useFakeTimers();
    const reportSyncOutcome = vi.fn(async () => undefined);
    const subscriber = new PluginRuntimeEventSubscriber(
      vi.fn(async () => undefined),
      createLogger(),
      10,
      reportSyncOutcome,
      applied,
    );
    const quote = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 2,
      eventType: 'config_updated',
    });
    const lfg = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'lfg',
      configVersion: 3,
      eventType: 'enabled',
    });

    subscriber.handleMessage(JSON.stringify(quote));
    subscriber.handleMessage(JSON.stringify(lfg));
    await vi.runAllTimersAsync();

    expect(reportSyncOutcome).toHaveBeenCalledTimes(1);
    expect(reportSyncOutcome).toHaveBeenCalledWith(
      expect.arrayContaining([quote, lfg]),
      'applied',
      1,
    );
  });

  it('同期処理がresolveしても対象Pluginの適用状態を確認できなければ失敗ACKにする', async () => {
    vi.useFakeTimers();
    const onGuildChanged = vi.fn(async () => undefined);
    const reportSyncOutcome = vi.fn(async () => undefined);
    const verifyApplied = vi.fn(() => false);
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'broken-plugin',
      configVersion: 7,
      eventType: 'config_updated',
    });
    const subscriber = new PluginRuntimeEventSubscriber(
      onGuildChanged,
      createLogger(),
      10,
      reportSyncOutcome,
      verifyApplied,
    );

    subscriber.handleMessage(JSON.stringify(event));
    await vi.runAllTimersAsync();

    expect(onGuildChanged).toHaveBeenCalledTimes(3);
    expect(verifyApplied).toHaveBeenCalledTimes(3);
    expect(reportSyncOutcome).toHaveBeenCalledWith([event], 'apply_failed', 3);
    expect(reportSyncOutcome).not.toHaveBeenCalledWith([event], 'applied', expect.any(Number));
  });

  it('ACK永続化失敗は再同期を再実行せずerrorNameだけをログへ残す', async () => {
    vi.useFakeTimers();
    const onGuildChanged = vi.fn(async () => undefined);
    const logger = createLogger();
    const persistenceError = new Error('redis://user:secret@example.invalid');
    persistenceError.name = 'AuditPersistenceError';
    const reportSyncOutcome = vi.fn(async () => {
      throw persistenceError;
    });
    const event = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 9,
      eventType: 'config_updated',
    });
    const subscriber = new PluginRuntimeEventSubscriber(
      onGuildChanged,
      logger,
      10,
      reportSyncOutcome,
      applied,
    );

    subscriber.handleMessage(JSON.stringify(event));
    await vi.runAllTimersAsync();

    expect(onGuildChanged).toHaveBeenCalledTimes(1);
    expect(reportSyncOutcome).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      {
        errorName: 'AuditPersistenceError',
        guildId: 'guild-a',
        eventIds: [event.eventId],
        outcome: 'applied',
      },
      'Plugin Runtime反映結果の永続化に失敗しました',
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('user:secret');
  });

  it('不正なpayloadを破棄する', async () => {
    vi.useFakeTimers();
    const onGuildChanged = vi.fn(async () => undefined);
    const subscriber = new PluginRuntimeEventSubscriber(
      onGuildChanged,
      createLogger(),
      10,
      vi.fn(async () => undefined),
      applied,
    );

    subscriber.handleMessage('{invalid');
    await vi.runAllTimersAsync();

    expect(onGuildChanged).not.toHaveBeenCalled();
  });
});
