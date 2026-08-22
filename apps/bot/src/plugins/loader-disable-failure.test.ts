import { describe, expect, it, vi } from 'vitest';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import { InMemoryGuildPluginCache } from './cache.js';
import { GuildPluginLoader } from './loader.js';
import { PluginRuntimeRegistry } from './registry.js';

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function enabled(pluginId: string): EnabledPlugin {
  return {
    manifest: { id: pluginId } as EnabledPlugin['manifest'],
    config: {},
    configVersion: 1,
  };
}

describe('GuildPluginLoader disable failure', () => {
  it('onDisable失敗後はreloadを中断し、次のdeactivation成功後に復旧する', async () => {
    const cache = new InMemoryGuildPluginCache();
    const fetchEnabledPlugins = vi.fn(async () => [enabled('moderation')]);
    const provideCommands = vi.fn(() => []);
    let disableShouldFail = true;
    const onDisable = vi.fn(async () => {
      if (disableShouldFail) throw new Error('disable failed');
    });
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'moderation',
          provideCommands,
          onDisable,
        },
      ]),
      cache,
      logger,
      fetchEnabledPlugins,
    });

    await loader.loadGuildPlugins('guild-a');
    await loader.disableGuildPlugins('guild-a');
    cache.invalidate('guild-a');

    await expect(loader.loadGuildPlugins('guild-a')).rejects.toThrow(
      'Plugin onDisable の失敗によりGuild再同期を継続できません',
    );
    expect(fetchEnabledPlugins).toHaveBeenCalledTimes(1);
    expect(provideCommands).toHaveBeenCalledTimes(1);

    disableShouldFail = false;
    await loader.disableGuildPlugins('guild-a');
    await expect(loader.loadGuildPlugins('guild-a')).resolves.toMatchObject({
      loaded: ['moderation'],
    });
    expect(fetchEnabledPlugins).toHaveBeenCalledTimes(2);
    expect(provideCommands).toHaveBeenCalledTimes(2);
  });
});
