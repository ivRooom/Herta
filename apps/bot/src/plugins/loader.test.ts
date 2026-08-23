import { describe, expect, it, vi } from 'vitest';
import type { EnabledPlugin } from '@herta/plugin-catalog';
import type { Logger } from '@herta/logger';
import { createPluginRuntimeEvent } from '@herta/shared';
import type { SlashCommand } from '../commands/registry.js';
import { InMemoryGuildPluginCache } from './cache.js';
import { GuildPluginLoader } from './loader.js';
import { PluginRuntimeRegistry } from './registry.js';
import { PluginRuntimeState } from './runtime-state.js';

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function enabled(
  pluginId: string,
  config: Record<string, unknown> = {},
  configVersion = 1,
): EnabledPlugin {
  return {
    manifest: { id: pluginId } as EnabledPlugin['manifest'],
    config,
    configVersion,
  };
}

function command(name: string): SlashCommand {
  return {
    definition: { name, description: name },
    execute: vi.fn(async () => undefined),
  };
}

describe('GuildPluginLoader', () => {
  it('有効Pluginだけをロードする', async () => {
    const registry = new PluginRuntimeRegistry([
      { pluginId: 'enabled', provideCommands: () => [command('enabled')] },
      { pluginId: 'disabled', provideCommands: () => [command('disabled')] },
    ]);
    const loader = new GuildPluginLoader({
      registry,
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('enabled')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['enabled']);
    expect(result.commands.map((item) => item.definition.name)).toEqual(['enabled']);
  });

  it('未知Pluginを警告してスキップする', async () => {
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('unknown')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual([]);
    expect(result.skipped).toEqual([
      { pluginId: 'unknown', reason: 'Registry に登録されていません' },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { guildId: 'guild-a', pluginId: 'unknown' },
      '未登録Pluginをスキップ',
    );
  });

  it('command名の重複時は後続Plugin全体を有効化せずスキップする', async () => {
    const onEnable = vi.fn(async () => undefined);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'first', provideCommands: () => [command('same')] },
        {
          pluginId: 'second',
          provideCommands: () => [command('same'), command('other')],
          onEnable,
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('first'), enabled('second')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['first']);
    expect(result.commands.map((item) => item.definition.name)).toEqual(['same']);
    expect(result.skipped[0]?.pluginId).toBe('second');
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('同一Plugin内のcommand名重複を検出して有効化しない', async () => {
    const onEnable = vi.fn(async () => undefined);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'duplicated',
          provideCommands: () => [command('same'), command('same')],
          onEnable,
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('duplicated')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.skipped[0]).toEqual({
      pluginId: 'duplicated',
      reason: 'command名 "same" が重複しています',
    });
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('cache invalidate後に設定変更を反映する', async () => {
    const cache = new InMemoryGuildPluginCache();
    let current = [enabled('plugin', { value: 'old' })];
    const provideCommands = vi.fn((config: Record<string, unknown>) => [
      command(String(config['value'])),
    ]);
    const fetch = vi.fn(async () => current);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([{ pluginId: 'plugin', provideCommands }]),
      cache,
      logger,
      fetchEnabledPlugins: fetch,
    });

    await loader.loadGuildPlugins('guild-a');
    current = [enabled('plugin', { value: 'new' })];
    expect((await loader.loadGuildPlugins('guild-a')).commands[0]?.definition.name).toBe('old');
    cache.invalidate('guild-a');
    expect((await loader.loadGuildPlugins('guild-a')).commands[0]?.definition.name).toBe('new');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('Guildごとにcacheを分離する', async () => {
    const cache = new InMemoryGuildPluginCache();
    const fetch = vi.fn(async (guildId: string) => [enabled(guildId)]);
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'guild-a', provideCommands: () => [command('a')] },
        { pluginId: 'guild-b', provideCommands: () => [command('b')] },
      ]),
      cache,
      logger,
      fetchEnabledPlugins: fetch,
    });

    await loader.loadGuildPlugins('guild-a');
    const result = await loader.loadGuildPlugins('guild-b');

    expect(result.loaded).toEqual(['guild-b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('Plugin providerの障害を隔離する', async () => {
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'broken',
          provideCommands: () => {
            throw new Error('broken');
          },
        },
        { pluginId: 'healthy', provideCommands: () => [command('healthy')] },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('broken'), enabled('healthy')]),
    });

    const result = await loader.loadGuildPlugins('guild-a');

    expect(result.loaded).toEqual(['healthy']);
    expect(result.commands[0]?.definition.name).toBe('healthy');
    expect(logger.error).toHaveBeenCalled();
  });

  it('cache失効だけではonEnableを再実行せず、明示的な無効化後に再実行する', async () => {
    const onEnable = vi.fn(async () => undefined);
    const onDisable = vi.fn(async () => undefined);
    const cache = new InMemoryGuildPluginCache();
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'lifecycle',
          provideCommands: () => [command('lifecycle')],
          onEnable,
          onDisable,
        },
      ]),
      cache,
      logger,
      fetchEnabledPlugins: vi.fn(async () => [enabled('lifecycle')]),
    });

    await loader.loadGuildPlugins('guild-a');
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(1);

    cache.invalidate('guild-a');
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(1);

    await loader.disableGuildPlugins('guild-a');
    expect(onDisable).toHaveBeenCalledTimes(1);
    await loader.loadGuildPlugins('guild-a');
    expect(onEnable).toHaveBeenCalledTimes(2);
  });

  it('ロード済みPluginのconfigVersionをRuntime適用状態として追跡する', async () => {
    const runtimeState = new PluginRuntimeState();
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'quote', provideCommands: () => [command('quote')] },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      runtimeState,
      fetchEnabledPlugins: vi.fn(async () => [enabled('quote', {}, 4)]),
    });

    await loader.loadGuildPlugins('guild-a');

    expect(
      runtimeState.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 4,
          eventType: 'config_updated',
        }),
      ),
    ).toBe(true);
    expect(
      runtimeState.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'quote',
          configVersion: 3,
          eventType: 'config_updated',
        }),
      ),
    ).toBe(true);
  });

  it('onDisable失敗時はRuntime状態をactiveのまま保持してdisable ACKを拒否する', async () => {
    const runtimeState = new PluginRuntimeState();
    const onDisable = vi.fn(async () => {
      throw new Error('disable failed');
    });
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        { pluginId: 'moderation', provideCommands: () => [], onDisable },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      runtimeState,
      fetchEnabledPlugins: vi.fn(async () => [enabled('moderation', {}, 6)]),
    });

    await loader.loadGuildPlugins('guild-a');
    await loader.disableGuildPlugins('guild-a');

    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(
      runtimeState.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'moderation',
          configVersion: 7,
          eventType: 'disabled',
        }),
      ),
    ).toBe(false);
  });

  it('providerでスキップされたPluginはRuntime適用済みにしない', async () => {
    const runtimeState = new PluginRuntimeState();
    const loader = new GuildPluginLoader({
      registry: new PluginRuntimeRegistry([
        {
          pluginId: 'broken',
          provideCommands: () => {
            throw new Error('broken');
          },
        },
      ]),
      cache: new InMemoryGuildPluginCache(),
      logger,
      runtimeState,
      fetchEnabledPlugins: vi.fn(async () => [enabled('broken', {}, 2)]),
    });

    await loader.loadGuildPlugins('guild-a');

    expect(
      runtimeState.isEventApplied(
        createPluginRuntimeEvent({
          guildId: 'guild-a',
          pluginId: 'broken',
          configVersion: 2,
          eventType: 'enabled',
        }),
      ),
    ).toBe(false);
  });
});
