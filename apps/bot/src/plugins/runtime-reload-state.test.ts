import { describe, expect, it, vi } from 'vitest';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import { createPluginRuntimeEvent } from '@herta/shared';
import { InMemoryGuildPluginCache } from './cache.js';
import { GuildPluginLoader } from './loader.js';
import { PluginRuntimeRegistry } from './registry.js';
import { PluginRuntimeState } from './runtime-state.js';

function enabled(pluginId: string, configVersion: number): EnabledPlugin {
  return {
    manifest: { id: pluginId } as EnabledPlugin['manifest'],
    config: {},
    configVersion,
  };
}

function createLogger(): Logger {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('Plugin Runtime reload state', () => {
  it('再同期時のDB取得失敗をdisable成功ACKとして扱わない', async () => {
    const cache = new InMemoryGuildPluginCache();
    const runtimeState = new PluginRuntimeState();
    let failFetch = false;
    const fetchEnabledPlugins = vi.fn(async () => {
      if (failFetch) throw new Error('database unavailable');
      return [enabled('quote', 1)];
    });
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([{ pluginId: 'quote', provideCommands: () => [] }]),
      cache,
      logger: createLogger(),
      runtimeState,
      fetchEnabledPlugins,
    });

    await loader.loadGuildPlugins('guild-a');
    failFetch = true;
    await loader.disableGuildPlugins('guild-a');
    cache.invalidate('guild-a');
    await loader.loadGuildPlugins('guild-a');

    expect(fetchEnabledPlugins).toHaveBeenCalledTimes(2);
    expect(
      runtimeState.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 2,
          eventType: 'disabled',
        }),
      ),
    ).toBe(false);
  });
});
