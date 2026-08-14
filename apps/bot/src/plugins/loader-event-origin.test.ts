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

describe('GuildPluginLoader event origin', () => {
  it('ロードしたEventへ提供元Plugin IDを付与する', async () => {
    const enabled: EnabledPlugin = {
      manifest: { id: 'xp-level' } as EnabledPlugin['manifest'],
      config: {},
      configVersion: 1,
    };
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'xp-level',
          provideEvents: () => [
            {
              event: 'messageCreate',
              handler: vi.fn(async () => undefined),
            },
          ],
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled]),
    });

    const events = await loader.getGuildEvents('guild-a');
    expect(events).toHaveLength(1);
    expect(events[0]?.pluginId).toBe('xp-level');
    expect(events[0]?.event).toBe('messageCreate');
  });
});
