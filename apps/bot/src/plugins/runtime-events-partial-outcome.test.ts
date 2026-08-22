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

describe('PluginRuntimeEventSubscriber partial outcomes', () => {
  it('同一Guildの一部Pluginだけ検証失敗した場合は失敗Pluginだけを再試行・失敗ACKする', async () => {
    vi.useFakeTimers();
    const onGuildChanged = vi.fn(async () => undefined);
    const reportSyncOutcome = vi.fn(async () => undefined);
    const healthy = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'quote',
      configVersion: 4,
      eventType: 'config_updated',
    });
    const broken = createPluginRuntimeEvent({
      guildId: 'guild-a',
      pluginId: 'moderation',
      configVersion: 7,
      eventType: 'enabled',
    });
    const subscriber = new PluginRuntimeEventSubscriber(
      onGuildChanged,
      createLogger(),
      10,
      reportSyncOutcome,
      (event) => event.pluginId === 'quote',
    );

    subscriber.handleMessage(JSON.stringify(healthy));
    subscriber.handleMessage(JSON.stringify(broken));
    await vi.runAllTimersAsync();

    expect(onGuildChanged).toHaveBeenCalledTimes(3);
    expect(reportSyncOutcome).toHaveBeenCalledWith([healthy], 'applied', 1);
    expect(reportSyncOutcome).toHaveBeenCalledWith([broken], 'apply_failed', 3);
    expect(reportSyncOutcome).not.toHaveBeenCalledWith(
      expect.arrayContaining([healthy]),
      'apply_failed',
      expect.any(Number),
    );
  });
});
